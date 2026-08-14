/**
 * El logo del comprobante, tal cual sale en el web.
 *
 * Se extrajo del `rc_recibo.frx` —donde vive incrustado como BMP de 1 bit— y se pasó a
 * PNG. Va como data URI porque la impresion arma un HTML suelto que no tiene de donde
 * cargar un archivo: cualquier `src` externo saldria como un hueco en el papel.
 *
 * Es monocromo a proposito. La termica solo sabe marcar o no marcar el punto, asi que
 * un logo con grises se convertiria a tramado y saldria sucio.
 */
export const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPcAAAB8AQAAAACdgBvlAAAC8klEQVR42u3XsYrbMBgHcBlDtZ2Grsepj3ClSzcNfZLSJ+jW4ahsAvVS8Bv0WWwM9ZhXUEjhVoUsGoS+fvIltuTI6ly4QJb8EkX+/t+nOASyD0de/X9yw/OuWN47mveqzDspsu4IyXuRd8s6mXPDlci5FjrrSq4KuPIODMt5jTvMeQmOZhwx637xMuN+83XGNRavz7iaLnHb+8t7tnw3lXDb6WUPW+5rZ8SmO27kqsMXx9pYgenbDVclGNlx41jaqwI0dFxvOXbuAX5wLWnSXdnBAJSrDbdMywYYV1ORbt3gytzd8R5XSbkW5rtwD2KIA5wdO/dJunvR4C5Tjp37BNa7Snrvg7EfJcMqpLz2r6PzOMDZS7+ueVwHGHh/cZtybHtsXPPZO0/6H2x882XqgpSzjjpmPuF4RgFeHQ8OZommmr502a0rYYhm2CVAU85PoN+hYzpN0jECpXk/QBTw1X3XdkqL3RBPYOj9QZNyhCjA0He9ImUTT+DaCV6c3vai4m0UYOCO9oe2wgYwabe07tsaxywMOLh+XdZ1U2seBbjUFweQFE1HRBTg7BQqQopBEYgCnPMtbdE9ohcQBTj3FyGlMsUwHc804RXBVw9Y/XMU0DIfhM8+pOaLyNn71Hz7L734Yet8Q3cfDmGAKx/BlJUMAlp5A6fhQZgtVxSOZyGCgFbnP4PnMxE25S2MgOE9n6OAFm/QceHJ2Ybj43gUElJOX/w0/JLBBC1ewnjyjfa2CwMKztcXBxkFtPj7i091+oerRH5fA9cJ/3Z1LMISQOT+Yw66cEKW893AWN3L8afc/RDLhCxu5eSdxJPI3bpGP+Gzxx9BsRR4cSImH6yPv9n00UqMf3fjR3dxI51YOnxx4JPvDaCrGx8inzt49hFY4POPeOBt4PNd1Ozt1af9z3dBgY+h12kX495N43G9S5mde3ei3TvubxE1u/Ej+h3bA/2NbovV+SS8A+F7qN6I6bwRKz+hd7IF9eDFEPn6/+XV3V+gaLrNFInBPgAAAABJRU5ErkJggg==";
