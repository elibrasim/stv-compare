# stv-compare

Tests automáticos que comparan el comportamiento de la app OTT (stv-boilerplate/stv-core)
entre distintas versiones y contra el mismo entorno de backend.

## Requisitos para instalarlo desde cero (p. ej. en el equipo de un compañero)

### 1. Acceso y herramientas base
- Acceso a este repo (`stv-compare`) y a los repos privados de Telefónica en
  GitHub: `stv-boilerplate`, `stv-core`, `gvp-js`.
- Git y Node.js/npm.
- **VPN/red de Telefónica**: `env=de` (y el resto de entornos reales) pegan
  contra backend real de producción/staging; sin acceso de red a esos hosts
  falla con `ERR_NAME_NOT_RESOLVED` / "Failed to fetch".
- `git-crypt`: en Windows solo existe binario para la release **0.7.0** (las
  versiones más nuevas no publican build para Windows). Además hace falta la
  clave de git-crypt del repo — no va en git, hay que compartirla aparte.

### 2. Montar stv-boilerplate/stv-core (la parte pesada)
Toda la receta detallada, con cada gotcha documentado, vive en
`C:\dev\CLAUDE.md`. Resumen por cada versión de la app que se quiera comparar
(p. ej. 26.1, 26.6):
- Clonar `stv-boilerplate`/`stv-core` y crear un **worktree** por versión
  (`git worktree add`), con el workaround de git-crypt+worktrees (copiar
  `.git/git-crypt` al worktree antes del primer checkout).
- Editar `package.json` del worktree: `"stv-core"` → `file:../stv-core-<ver>`
  (evita que npm intente un `--mirror` clone completo por SSH), borrar
  `package-lock.json`, `npm install`.
- Editar `webpack.config.local.dev.js`: `coreRoot` apuntando al worktree de
  `stv-core` correcto.
- `npm install --save-dev regenerator-runtime` (falta en el `package.json`
  del boilerplate y `main.dev.js` lo necesita).
- Si se apunta a un país sin `src/i18n/<locale>/` en el boilerplate (todo
  menos `es-PE`): copiar la carpeta de traducciones real de ese locale.
- Todo esto **fuera de OneDrive** (p. ej. en `C:\dev`, no en una carpeta
  sincronizada) — si no, aparecen `EPERM` intermitentes de npm/git.

### 3. stv-compare en sí
- Clonar este repo: `git clone <url-del-remoto> stv-compare` (como carpeta
  hermana de los worktrees de `stv-boilerplate`, según las rutas relativas de
  `compare.config.json` — ver más abajo).
- `npm install` dentro de la carpeta clonada.
- `npx playwright install` — descarga los navegadores (Chromium) que
  Playwright necesita; no vienen con `npm install`.
- Ajustar `compare.config.json`: `versions[].path` son rutas relativas a los
  worktrees de `stv-boilerplate` — deben coincidir con cómo cada persona
  organice su propio `C:\dev`.
- `npm test`. El `webServer` de `playwright.config.js` arranca automáticamente
  `devServer.sh` para cada versión si no hay nada respondiendo ya en su
  puerto, o se conecta a instancias que ya estén corriendo (útil si prefieres
  levantarlas a mano para verlas en vivo mientras corre el test).

## Por qué existe

La UI se renderiza entera en un canvas WebGL (Pixi.js) — no hay DOM real para
el contenido en pantalla, así que Playwright no puede hacer scraping normal.
En su lugar, este proyecto lee los datos directamente de las instancias de
componente vivas en `window.__PIXI_APP__` (disponible siempre que se use
`devServerLocal`, que activa `DEBUG` vía `KEEP_LOG=true`).

Ver `lib/pixiInspector.js` para el detalle de cómo se enlaza cada
`DisplayObject` de Pixi con su componente `UIC*` dueño.

## Qué compara hoy

- **Home**: que las tiras ("rails") mostradas son las mismas y están en el
  mismo orden entre versiones, paginando con la tecla abajo hasta agotar la
  lista (`tests/home-rails.spec.js`).

Próximos escenarios previstos (misma base de código, solo hace falta añadir
la navegación específica en `lib/navigation.js` + un nuevo spec):
- Que cada sección del menú principal abre la misma pantalla con las mismas
  tiras en ambas versiones.
- Que el "ver más" de cada tira de Home abre la misma página con el mismo
  contenido en ambas versiones.

`lib/pixiInspector.js` y `lib/compareLists.js` ya son genéricos (reciben qué
`tagName`s buscar / qué listas comparar), así que estos escenarios nuevos no
deberían requerir tocarlos.

## Configurar qué se compara

Edita `compare.config.json`:

```json
{
  "env": "de",
  "device": {"id": "REPLACE_WITH_YOUR_DEVICE_ID", "type": 0},
  "versions": [
    {"name": "26.1", "path": "../stv-boilerplate-26.1", "port": 8080},
    {"name": "26.6", "path": "../stv-boilerplate-26.6", "port": 8081}
  ]
}
```

> El `device.id`/`device.type` de ejemplo son un placeholder a propósito — sustitúyelos por un
> device id real de tu propio entorno de pruebas. Al ser un repo público, no dejes aquí un device
> id real: identifica una cuenta/sesión concreta en el backend de producción.

- `env`: query param `?env=` que se pasa a ambas versiones (debe ser el mismo
  para que la comparación sea justa — cada versión trae un `GVPEnvs.current`
  por defecto distinto, por lo que hay que fijarlo explícitamente). Determina
  también el país/backend (`de` = producción Alemania, `pe` = Perú, etc. —
  ver `src/__dev__/service/gvp/config/GVPEnvs.dev.encrypt.js` en cualquiera
  de los checkouts de `stv-boilerplate` para la lista completa de claves).
- `device` (opcional pero recomendado): fija `?did=&dtype=` en ambas
  versiones. El `device.id` es lo que ata la sesión a una cuenta/usuario en
  el backend, así que sin esto cada versión podría usar su propio `device.id`
  por defecto para ese `env` y terminar comparando contenido de **usuarios
  distintos**, no solo de versiones distintas. Si se omite, se avisa por
  consola y cada versión usa su propio device id por defecto para ese `env`,
  que no tiene por qué coincidir entre versiones ni entre entornos.
- `versions`: 2 o más entradas. `path` es relativo a este proyecto y debe
  apuntar a un checkout de `stv-boilerplate` con `node_modules` ya instalado.
  Cada versión necesita su propio `port`. Con más de 2 versiones, el test se
  ejecuta para cada pareja posible.

## Cómo correrlo

```bash
git clone <url-del-remoto> stv-compare
cd stv-compare
npm install
npx playwright install
npm test
```

Playwright arranca automáticamente un `devServerLocal` por cada versión del
config (puertos definidos ahí), espera a que respondan, y corre los tests.

## Importante: esto pega a backend real

`env` apunta a un entorno real de Telefonica (staging o producción), no a
mocks. El contenido de una tira puntual puede variar entre ejecuciones por
personalización/franja horaria/promos, independientemente de la versión de
la app. Lo que este test valida de forma fiable es **qué tiras existen y en
qué orden** — si falla por el conjunto/orden de tiras, es una señal real; si
solo cambia el contenido interno de una tira que sigue llamándose igual, eso
no lo detecta este test (a propósito, para no generar falsos positivos por
contenido dinámico).

Corre ambas versiones seguidas en el tiempo para minimizar ese ruido.
