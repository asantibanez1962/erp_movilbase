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
  /* ⚠️ LO CENTRADO SE CENTRA EN EL PAPEL, NO EN EL CUERPO. El body tiene 4.2 mm de padding
     a la izquierda y 1 a la derecha —asimetría buscada, para que el texto alineado a la
     izquierda no arranque contra el borde—, y eso corría todo lo centrado 1.6 mm a la
     derecha y le quitaba 3.2 mm de ancho. Se notaba: "RECIBO DE TRANSPORTE" no entraba.
     El margen negativo le devuelve esos 3.2 mm y lo vuelve a centrar sobre el rollo. */
  .c, .titulo, .estado { margin-left: -3.2mm; }
  .c { text-align: center; }
  .m { font-weight: bold; }
  /* 10pt y no los 12 del .frx: alla el titulo del recibo entra porque dice RECIBO DE
     CAFE; el de la remedida dice RECIBO DE TRANSPORTE, 43 % mas largo, y el .frx lo
     compensa dandole una caja de 63 mm contra 45. Aca no hay cajas, asi que se baja el
     cuerpo para que el mas largo entre. */
  .titulo { font-size: 10pt; font-weight: bold; text-align: center; margin: 2.5mm 0 1.5mm -3.2mm; }
  .estado { font-weight: bold; text-align: center; margin: 0.8mm 0 1.2mm -3.2mm; }
  /* El logo y la caja tienen ancho propio y se centran con margen automático, así que no se
     les puede dar margen negativo sin descentrarlos: se corren con la propiedad left, que
     los mueve sin rehacer el layout.
     ⚠️ SE FIJA EL ALTO Y NO EL ANCHO. Cada cliente trae su logo con la proporción que sea, y
     lo que está contado en este papel es el ESPACIO VERTICAL: el recibo entra en la página
     por unos pocos milímetros. Con el ancho fijo, un logo más alto que el anterior empuja
     todo hacia abajo — pasó al cambiar el de Altura, que sumó 4 mm de golpe. Con el alto
     fijo, cualquier logo ocupa lo mismo y el largo del comprobante no depende de con qué
     proporción lo exportaron.
     El max-width es el freno para un logo muy apaisado, que si no se saldría del papel. */
  .logo { display: block; margin: 0 auto 0.8mm; height: 16mm; width: auto; max-width: 45mm;
          position: relative; left: -1.6mm; }
  /* Dos columnas: la etiqueta llega hasta los 23 mm, que es donde el .frx pone el valor. */
  .par { display: flex; }
  .par > span:first-child { flex: 0 0 23mm; }
  /* Que el valor pueda partirse en vez de estirar la fila más allá del papel. */
  .par > span:last-child { min-width: 0; }
  .bloque { margin-top: 1mm; }
  /* La caja de CAFE EN FRUTA es lo único con recuadro, en los dos documentos. */
  .caja { border: 1px solid #000; width: 34.3mm; margin: 1.2mm auto 0.8mm;
          text-align: center; position: relative; left: -1.6mm; }
`;
