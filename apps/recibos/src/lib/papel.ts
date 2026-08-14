/**
 * El estilo del papel térmico, compartido por los documentos que van al cliente.
 *
 * Existe para que el recibo y la remedida no se separen con el tiempo. Los dos salen del
 * mismo `.frx` de 76,2 mm, por la misma impresora y por el mismo camino —HTML → diálogo de
 * Android → ESCprint—, así que cada milímetro que hubo que pelear para uno vale igual para
 * el otro. Con el CSS duplicado, el primer ajuste que se haga en uno deja al otro atrás y
 * nadie lo nota hasta que sale en papel.
 *
 * ⚠️ NADA DE BACKTICKS EN ESTOS COMENTARIOS: todo esto se inserta en un template literal, y
 * un backtick lo corta — el navegador deja de ver estilos y el parser de TS empieza a leer
 * el CSS como código. Ya pasó dos veces.
 *
 * La BITÁCORA no usa esto: va por socket directo en texto plano, porque su largo depende de
 * cuántos recibos lleve. Ver `bitacoraTexto.ts`.
 */
export const ESTILO_PAPEL = `
  /* ⚠️ TIPOGRAFÍA DEL WEB, TAL CUAL: Verdana 8.25 pt, con el título a 12 pt en negrita.
     Costó llegar a estos valores contra la impresora y no se tocan sin volver a probar EN
     PAPEL. Android no trae Verdana y el WebView cae a Roboto, que es más angosto: las
     líneas salen algo más cortas que en el web y nada se desborda. Para que fueran
     idénticas habría que empotrar la fuente, y Verdana es de Microsoft. */
  @page { size: 76.2mm auto; margin: 0; }
  /* ⚠️ EL ANCHO Y LOS MÁRGENES VAN EN EL BODY, NO EN @page. Android imprime pasando el
     HTML por su propio framework, que decide el tamaño de página desde el driver e IGNORA
     los márgenes de la regla @page: el texto salía pegado al borde izquierdo del rollo.
     Puestos como padding del body, sí se respetan.
     72 mm es el área imprimible que declara la 3nStar (el driver la lista como "80(72MM)"):
     80 mm de papel, 72 de tinta. El border-box hace que el padding entre dentro de esos 72
     y no los estire.
     Y el ancho va FIJO, no heredado: sin declararlo, las filas de dos columnas —que son
     flex, y un flex no se encoge por debajo de su contenido— empujan la página más ancha
     que el papel, todo lo centrado se descentra y el rollo corta el borde derecho.
     ⚠️ LOS 6.35 mm DE ABAJO NO SON RELLENO: son para poder ARRANCAR el papel. La impresora
     no tiene cuchilla, así que se corta a mano contra el borde, y el cabezal queda un tramo
     por detrás: sin margen, arrancar se lleva la última línea. Se pisa con "Bottom saving
     paper" del driver, que recorta justamente ese blanco — una o la otra, nunca las dos. */
  body { font-family: Verdana, "DejaVu Sans", Tahoma, Geneva, sans-serif;
         font-size: 8.25pt; line-height: 1.32; margin: 0; color: #000;
         box-sizing: border-box; width: 72mm; padding: 0 1mm 6.35mm 4.2mm;
         overflow-wrap: break-word; }
  .c { text-align: center; }
  .m { font-weight: bold; }
  .titulo { font-size: 12pt; font-weight: bold; text-align: center; margin: 2.5mm 0 1.5mm; }
  .estado { font-weight: bold; text-align: center; margin: 0.8mm 0 1.2mm; }
  .logo { display: block; margin: 0 auto 0.8mm; width: 30mm; }
  /* Dos columnas: la etiqueta llega hasta los 23 mm, que es donde el .frx pone el valor. */
  .par { display: flex; }
  .par > span:first-child { flex: 0 0 23mm; }
  /* Que el valor pueda partirse en vez de estirar la fila más allá del papel. */
  .par > span:last-child { min-width: 0; }
  .bloque { margin-top: 1mm; }
  /* La caja de CAFE EN FRUTA es lo único con recuadro, en los dos documentos. */
  .caja { border: 1px solid #000; width: 34.3mm; margin: 1.2mm auto 0.8mm; text-align: center; }
`;
