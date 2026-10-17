# Dashboard personal + Strava (GitHub + Netlify)

Reparto: el dashboard (`docs/index.html`) se publica en **GitHub Pages**, gratis y sin límite de cambios. En **Netlify** solo viven las funciones de Strava (`netlify/`), que casi nunca cambian.
Gracias a la regla `ignore` de `netlify.toml`, Netlify solo vuelve a construir cuando cambia `netlify/`, `package.json` o `netlify.toml`. Subir cambios del HTML no gasta nada en Netlify.

## 1. Crear la aplicación en Strava
1. Entra en https://www.strava.com/settings/api y crea una aplicación.
2. En "Authorization Callback Domain" pon solo el dominio de **Netlify** (por ejemplo `tu-funciones.netlify.app`, sin https ni barras).
3. Apunta el **Client ID** y el **Client Secret**.
Las condiciones de la API cambian a menudo (https://www.strava.com/legal/api). Los datos solo se muestran a su propietario, por eso el dashboard va protegido con clave.

## 2. Subir el repositorio a GitHub
Sube esta carpeta entera como repositorio. En GitHub: Settings → Pages → Source: "Deploy from a branch", rama `main`, carpeta `/docs`. Tu dashboard quedará en `https://TU-USUARIO.github.io/TU-REPO/`.

## 3. Conectar el repositorio con Netlify (solo funciones)
Crea el sitio desde ese mismo repositorio. No hace falta configurar nada más: `netlify.toml` ya indica la carpeta de funciones.
Variables de entorno (Site configuration → Environment variables):
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `DASH_KEY`: una clave larga que inventes (la usarás en el dashboard).
- `ALLOWED_ORIGIN`: la dirección de tu GitHub Pages sin ruta, por ejemplo `https://TU-USUARIO.github.io`. Solo ese origen podrá leer los datos desde el navegador.
Despliega una vez después de crearlas.

## 4. Enlazar el dashboard con las funciones y conectar Strava
1. En `docs/index.html` busca `const API_BASE=""` y pon la dirección de tu Netlify, por ejemplo `const API_BASE="https://tu-funciones.netlify.app"`. Sube el cambio a GitHub (no dispara Netlify).
2. Abre una sola vez `https://tu-funciones.netlify.app/.netlify/functions/strava-auth?key=TU_DASH_KEY`, acepta los permisos en Strava (actividades y perfil; el de perfil sirve para leer los nombres de las zapatillas) y verás "Strava conectado". El token se guarda en el servidor (Netlify Blobs), nunca en la página.

## Privacidad y buscadores
El dashboard lleva `noindex, nofollow, noarchive, nosnippet` (etiquetas meta) para que los buscadores bien portados no lo indexen, y el sitio de Netlify envía la cabecera `X-Robots-Tag` equivalente. No hay `robots.txt` a propósito: si bloqueara el rastreo, los buscadores no leerían el `noindex` y podrían listar igualmente la dirección. Ninguna de las dos cosas impide entrar a quien tenga el enlace; para eso está la clave. Si el repositorio de GitHub es público, su código se puede ver (no contiene claves: viven en Netlify).

## 5. Usar el dashboard
Abre tu GitHub Pages. En la tarjeta Running pulsa "Conectar Strava", escribe tu `DASH_KEY` y listo. Se guarda en ese navegador; en otro dispositivo hay que escribirla una vez.
Los datos se piden como mucho cada 15 minutos (caché del servidor) y el botón "Actualizar" fuerza una lectura.

## Qué calcula
- Km del mes, del año y por mes: carreras (Run, TrailRun, VirtualRun) por fecha local. Total: estadísticas de Strava.
- Ritmo medio, tiempo, desnivel y FC media (mes y año; la FC solo si Strava la tiene).
- Última carrera con mapa de la ruta, calendario de actividad (12 meses), racha de semanas y días, mejor semana, km por día de la semana.
- Proyección a fin de año con tu ritmo de las últimas 12 semanas, frente al año anterior y a tu objetivo.
- Zapatillas: km de cada par sobre una vida útil orientativa.
- Mejores marcas (1 km, 5 km, 10 km, media y maratón): Strava calcula los mejores esfuerzos dentro de cada carrera, así que hay que leer las carreras una a una. El dashboard lo hace por tandas de 20 y con un límite de 4 tandas por visita, para no agotar el cupo de Strava. Con un historial largo tarda unas cuantas visitas en completarse, y verás "Analizando tu historial: x de y". Lo ya analizado se guarda.

## Ajustes rápidos (en `docs/index.html`)
`GOAL_YEAR` (objetivo anual de km) y `GEAR_LIFE` (vida útil de las zapatillas) están al principio del bloque "Análisis de running". La meta mensual es `DATA.run.goalMonth`.

## Límites de Strava
La API de Strava limita las peticiones por periodos de 15 minutos y por día (el límite exacto depende de tu aplicación; mira el de la tuya en strava.com/settings/api). El servidor guarda los resultados 15 minutos y avisa si Strava pide esperar. Con ello cada visita al dashboard hace como mucho una llamada a las funciones de Netlify cada 15 minutos, más las tandas de mejores marcas mientras se completan.

## Pruebas
`npm install && npm test`
