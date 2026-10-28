const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("@expo/config-plugins");

/**
 * Plugin de parche a expo-print: arregla los dos cuelgues que dejan la impresion
 * trabada hasta reiniciar la app.
 *
 * EL PROBLEMA QUE ARREGLA
 * -----------------------
 * `Print.ts` tiene una bandera de modulo:
 *
 *     if (isPrinting) throw new Error('Another print request is already in progress');
 *     isPrinting = true;
 *     try { return await ExponentPrint.print(options); } finally { isPrinting = false; }
 *
 * El `finally` solo corre si la promesa nativa TERMINA. Hay dos caminos por los
 * que no termina nunca, y cualquiera de los dos deja `isPrinting` en `true` para
 * el resto de la vida del proceso:
 *
 *  1. EL RECOLECTOR SE LLEVA LA TAREA. `PrintPDFRenderTask` crea un WebView
 *     fuera de la jerarquia de vistas y solo existia como variable local de
 *     `PrintModule.print`. Nada en el proceso la referencia: el unico lazo que
 *     queda, WebView <-> WebViewClient, es un ciclo que el GC sabe romper. Si
 *     entra un GC antes de `onPageFinished`, la continuacion no se reanuda.
 *     Reportado en expo/expo#52422.
 *
 *  2. `printDocumentToPrinter` TIRA DENTRO DE UN CALLBACK DEL WEBVIEW. Usa
 *     `appContext.throwingActivity`, que tira si en ese instante no hay
 *     actividad —app en segundo plano, pantalla bloqueada—. Corre fuera del
 *     try/catch de `print`, asi que nadie la cacha y tampoco se reanuda.
 *
 * POR QUE UN PLUGIN Y NO `pnpm patch`
 * -----------------------------------
 * Primero se hizo con `pnpm patch` y el APK salio SIN el parche, sin un solo
 * error: el build de EAS corrio `pnpm install --frozen-lockfile` sin quejarse y
 * el `.dex` no traia ni una de las cadenas agregadas. Este repo usa
 * `node-linker=hoisted` —lo pide Expo para que Metro encuentre los modulos— y
 * ahi el parcheo de pnpm no es confiable.
 *
 * El prebuild SI corre en EAS: en ese mismo build se ve el aviso del plugin de
 * firma en el log. Por eso el parche vive aca, donde se puede comprobar que
 * corrio.
 *
 * POR QUE ESTE ROMPE Y EL DE LA FIRMA NO
 * --------------------------------------
 * `firma-release.js` avisa y sigue si falta el keystore, a proposito: quien
 * clona el repo puede trabajar sin el. Aca es al reves. Si un dia expo-print
 * cambia y los anclajes no calzan, seguir de largo produce exactamente el bug
 * que este archivo viene a tapar —y uno intermitente, que aparece en el campo y
 * no en la prueba—. Preferimos que no compile.
 */

const RELATIVO = "android/src/main/java/expo/modules/print";
const MARCA = "PARCHE LOCAL";

/** Cada entrada: el ancla tal como viene de upstream, y con que se reemplaza. */
const CAMBIOS = {
  "PrintPDFRenderTask.kt": [
    {
      que: "el conjunto de tareas en vuelo",
      de: `  private var numberOfPages = 0

  @UiThread
`,
      a: `  private var numberOfPages = 0

  companion object {
    /**
     * PARCHE LOCAL — las tareas que estan renderizando ahora mismo.
     *
     * Sin esto nada en el proceso tiene una referencia viva a la tarea, y un GC
     * a destiempo deja la promesa de JS colgada para siempre. Ver el comentario
     * de plugins/parche-expo-print.js y expo/expo#52422.
     */
    private val enVuelo: MutableSet<PrintPDFRenderTask> =
      java.util.Collections.synchronizedSet(mutableSetOf())
  }

  /** PARCHE LOCAL — suelta la tarea. Idempotente: se puede llamar de mas. */
  private fun soltar() {
    enVuelo.remove(this)
  }

  @UiThread
`,
    },
    {
      que: "registrar la tarea antes de cargar",
      de: `    webView.loadDataWithBaseURL(null, html, "text/html; charset=utf-8", "UTF-8", null)
  }`,
      a: `    // PARCHE LOCAL — la tarea queda viva hasta que termine de renderizar. Tiene que ir
    // ANTES de arrancar la carga: despues ya hay una ventana en la que el GC puede entrar.
    enVuelo.add(this)
    webView.loadDataWithBaseURL(null, html, "text/html; charset=utf-8", "UTF-8", null)
  }`,
    },
    {
      que: "onPageFinished a prueba de excepciones",
      de: `    override fun onPageFinished(view: WebView, url: String) {
      document = view.createPrintDocumentAdapter("Document")
      // layout the document with appropriate print attributes
      document.onLayout(null, printAttributes, null, object : PrintDocumentAdapterLayoutCallback() {}, null)
      @SuppressLint("Range")
      val pageHeight = PIXELS_PER_MIL * printAttributes.mediaSize!!.heightMils
      numberOfPages = 1 + (view.contentHeight / pageHeight).toInt()

      // Write to a file if file path was passed, otherwise invoke onRenderFinish callback
      if (fileDescriptor != null) {
        document.onWrite(arrayOf(PageRange.ALL_PAGES), fileDescriptor, null, printDocumentWriteCallback)
      } else {
        callbacks.onRenderFinished(document, null, numberOfPages)
      }
    }`,
      a: `    override fun onPageFinished(view: WebView, url: String) {
      // PARCHE LOCAL — esto corre en un callback del WebView, o sea en el hilo de UI y
      // fuera del try/catch de PrintModule.print. Una excepcion aca no la cacha nadie y
      // deja la promesa colgada, que es el mismo sintoma que el GC.
      try {
        document = view.createPrintDocumentAdapter("Document")
        // layout the document with appropriate print attributes
        document.onLayout(null, printAttributes, null, object : PrintDocumentAdapterLayoutCallback() {}, null)
        @SuppressLint("Range")
        val pageHeight = PIXELS_PER_MIL * printAttributes.mediaSize!!.heightMils
        numberOfPages = 1 + (view.contentHeight / pageHeight).toInt()
      } catch (e: Throwable) {
        soltar()
        callbacks.onRenderError(UnexpectedPrintException("Failed to lay out the document for printing ", e))
        return
      }

      // Write to a file if file path was passed, otherwise invoke onRenderFinish callback
      if (fileDescriptor != null) {
        document.onWrite(arrayOf(PageRange.ALL_PAGES), fileDescriptor, null, printDocumentWriteCallback)
      } else {
        soltar()
        callbacks.onRenderFinished(document, null, numberOfPages)
      }
    }`,
    },
    {
      que: "soltar la tarea al terminar de escribir",
      de: `    override fun onWriteFinished(pages: Array<PageRange>) {
      // document and output file are now ready to finish
      callbacks.onRenderFinished(document, outputFile, numberOfPages)
    }

    override fun onWriteFailed(error: CharSequence?) {
      callbacks.onRenderError(PdfWriteException())
    }`,
      a: `    override fun onWriteFinished(pages: Array<PageRange>) {
      // document and output file are now ready to finish
      soltar() // PARCHE LOCAL
      callbacks.onRenderFinished(document, outputFile, numberOfPages)
    }

    override fun onWriteFailed(error: CharSequence?) {
      soltar() // PARCHE LOCAL
      callbacks.onRenderError(PdfWriteException())
    }`,
    },
  ],
  "PrintModule.kt": [
    {
      que: "reanudar si falla la entrega a la impresora",
      de: `      override fun onRenderFinished(document: PrintDocumentAdapter, outputFile: File?, numberOfPages: Int) {
        printDocumentToPrinter(document, options)
        continuation.resume(Unit)
      }`,
      a: `      override fun onRenderFinished(document: PrintDocumentAdapter, outputFile: File?, numberOfPages: Int) {
        // PARCHE LOCAL — printDocumentToPrinter tira si no hay actividad en ese instante.
        // Sin este try la excepcion sale por un callback del WebView, la continuacion no
        // se reanuda nunca y la promesa de JS queda colgada. Ver expo/expo#52422.
        try {
          printDocumentToPrinter(document, options)
        } catch (e: Throwable) {
          continuation.resumeWithException(
            if (e is CodedException) e
            else UnexpectedPrintException("There was an error while trying to print ", e)
          )
          return
        }
        continuation.resume(Unit)
      }`,
    },
  ],
};

function carpetaDeExpoPrint(raizProyecto) {
  const manifiesto = require.resolve("expo-print/package.json", { paths: [raizProyecto] });
  return path.join(path.dirname(manifiesto), RELATIVO);
}

function aplicar(raizProyecto) {
  const carpeta = carpetaDeExpoPrint(raizProyecto);

  for (const [archivo, cambios] of Object.entries(CAMBIOS)) {
    const ruta = path.join(carpeta, archivo);
    let fuente = fs.readFileSync(ruta, "utf8");

    if (fuente.includes(MARCA)) {
      console.log(`parche-expo-print: ${archivo} ya estaba parcheado.`);
      continue;
    }

    for (const { que, de, a } of cambios) {
      const veces = fuente.split(de).length - 1;
      if (veces !== 1) {
        // Romper, no avisar. Un parche que no se aplica devuelve un bug
        // intermitente que solo se ve en el campo.
        throw new Error(
          `parche-expo-print: en ${archivo} el anclaje de "${que}" aparece ${veces} veces ` +
            `(se esperaba 1). Seguramente expo-print cambio: hay que rehacer el parche ` +
            `contra la version nueva, o quitarlo si upstream ya lo arreglo.`
        );
      }
      fuente = fuente.replace(de, a);
    }

    fs.writeFileSync(ruta, fuente);
    console.log(`parche-expo-print: ${archivo} parcheado (${cambios.length} cambios).`);
  }
}

module.exports = function conParcheExpoPrint(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      aplicar(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);
};
