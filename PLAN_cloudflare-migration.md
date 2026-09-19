# Plan (temporaire) — Migration hébergement VR : Hostinger → Cloudflare

> Document de travail, pas une doc projet pérenne. À supprimer une fois la
> migration faite et documentée (README ou équivalent).

## Objectif

Migrer l'hébergement des 15 scènes VR (actuellement sur le même Hostinger
que le globe `prehistoric-domain-timetravel`) vers Cloudflare, en
réutilisant le mécanisme `ASSET_PREFIX` déjà présent dans le code
(`loaders/html-require-loader.js`) qui réécrit les chemins `/assets/...`
vers un préfixe externe configurable au build.

## Contexte technique découvert

- **15 scènes indépendantes** (`build-all.js`) : `tour`, `aviary`, `lagoon`,
  `cretaceousLagoon`, `sarco`, `spino`, `dimetrodon`, `quetza`, `trex`,
  `edmon`, `deino`, `deinocheirus`, `mammoth`, `home`, `gallery`
- Chaque scène build dans **`dist/<scene-dash-case>/`** (`index.html` +
  `build.[contenthash].js`), via `webpack.prod.config.js` — output isolé
  par scène (`CleanWebpackPlugin` ne nettoie que le sous-dossier de la
  scène en cours, pas tout `dist/`), donc `build-all.js` ne les fait pas
  s'écraser entre elles
- ⚠️ `build-all.js` lance les 15 builds via `exec()` **sans les attendre**
  (fire-and-forget, pas de `Promise`/`await`, pas de gestion d'erreur) — à
  vérifier/durcir avant de s'appuyer dessus pour un pipeline de déploiement
  reproductible (risque : un build silencieusement en échec ou incomplet
  au moment du déploiement)
- **`assets/` pèse 2,1 Go, 1421 fichiers**, dont au moins 14 dépassent déjà
  la limite Cloudflare Pages de **25 Mo/fichier** (jusqu'à 85 Mo pour un
  `.psd`, plusieurs `.glb` entre 25 et 52 Mo) → Pages seul ne peut pas
  héberger ces assets tels quels
- **`ASSET_PREFIX`** (`loaders/html-require-loader.js:36`) réécrit
  `/assets/...` → `<prefix>/assets/...` dans le HTML au build — mécanisme
  déjà en place pour séparer code et assets, jamais branché sur un
  vrai prefix externe pour l'instant (`grep` ne trouve aucun usage en prod)
- Aucune référence Hostinger/rsync/deploy trouvée dans le repo — la mise en
  prod actuelle se fait donc manuellement ou via un process hors-repo

## Portée décidée

- **Hébergement actuel** : même Hostinger que le globe → c'est bien une
  **migration**, même logique que celle déjà faite pour
  `prehistoric-domain-timetravel`
- **Architecture retenue : split R2 (assets) + Pages (code)**
  - **Cloudflare R2** héberge `assets/` (2,1 Go, fichiers jusqu'à 85 Mo —
    R2 n'a pas la limite 25 Mo de Pages), exposé via un domaine custom
  - **Cloudflare Pages** héberge `dist/` (les 15 sous-dossiers de scènes,
    légers — juste HTML + JS bundlé) — chaque scène accessible en
    `/<scene>/` sur un seul projet Pages (pas 15 projets séparés)
  - Au build, `--assetprefix=<url R2 custom domain>` fait pointer
    `html-require-loader.js` vers R2 au lieu de `/assets/` local
- **Périmètre** : les 15 scènes en une fois (pas de migration partielle)

## Points ouverts à trancher avant implémentation

1. ~~Nom du bucket R2~~ → **décidé : `prehistoric-domain-assets`**. Domaine
   custom encore à définir (ex: `assets.prehistoricdomain.com`, nécessite
   un enregistrement DNS sur `prehistoricdomain.com`) — pas encore fait
2. ~~Nom du projet Cloudflare Pages~~ → **décidé : `prehistoric-domain-vr`**,
   ✅ créé (`https://prehistoric-domain-vr.pages.dev`)
3. ~~Outil d'upload vers R2~~ → **décidé : `rclone`** (installé,
   `brew install rclone`) — sync incrémental, credentials via `.env.r2`
   (gitignored) ou variables d'env, pas de config `rclone config`
   persistée. Script : `sync-assets-r2.js`
4. ~~Fiabilité de `build-all.js`~~ → **corrigé** (2026-09-03) :
   `exec()` fire-and-forget remplacé par `execFileSync` séquentiel, échoue
   bruyamment si un build échoue. Testé : les 15 scènes rebuildent
   correctement (nouveaux hashes à chaque run), ~1min45 pour les 15,
   `dist/` = 40 Mo total (bien sous les limites Pages)
5. ~~Transition~~ → **décidé : coupure nette**, même logique que le globe
6. ~~Confirmation manuelle avant déploiement~~ → **décidé : oui**, même
   règle que le globe (pas d'auto-deploy)

## Statut

### Fait (2026-09-03)
- `rclone` installé
- Bucket R2 `prehistoric-domain-assets` — ⏳ **bloqué**, R2 doit être activé
  manuellement par Benjamin dans le dashboard Cloudflare (`wrangler r2
  bucket create` échoue avec `Please enable R2 through the Cloudflare
  Dashboard [code: 10042]`) avant de pouvoir le créer
- Projet Pages `prehistoric-domain-vr` créé
- `build-all.js` corrigé et validé (15/15 scènes, séquentiel, fiable)
- `deploy-pages.js` écrit (même pattern que celui de
  `prehistoric-domain-timetravel` : garde-fous build/auth, `wrangler pages
  deploy`)
- `sync-assets-r2.js` écrit (rclone, credentials via `.env.r2` gitignored,
  jamais commitées)
- `package.json` : `npm run deploy:pages` / `npm run sync:assets` ajoutés

### Fait (2026-09-04) — migration complète, validée en production
- R2 activé, bucket `prehistoric-domain-assets` créé et rempli (2,113 Go,
  1421 fichiers, sous `assets/` — **pas** à la racine du bucket, cf. gotcha
  ci-dessous)
- Accès public activé via l'URL r2.dev :
  `https://pub-817931622cc34071a6de663b326a0df2.r2.dev` (pas de domaine
  custom pour l'instant — suffisant pour le volume de trafic actuel,
  ~200 visites/jour ≪ quotas gratuits R2)
- Credentials R2 dans `.env.r2` (gitignored, jamais commité)
- Les 15 scènes buildées avec `--assetprefix=https://pub-817931622cc34071a6de663b326a0df2.r2.dev`
  et déployées sur **https://prehistoric-domain-vr.pages.dev** — toutes
  vérifiées HTTP 200 (`/tour/`, `/aviary/`, `/lagoon/`,
  `/cretaceous-lagoon/`, `/sarco/`, `/spino/`, `/dimetrodon/`, `/quetza/`,
  `/trex/`, `/edmon/`, `/deino/`, `/deinocheirus/`, `/mammoth/`, `/home/`,
  `/gallery/`)

### Gotchas rencontrés et corrigés
- **`rclone purge` bloqué par le classifieur Claude Code** (action
  destructive) — normal, a nécessité une confirmation explicite avant de
  nettoyer les fichiers mal placés
- **Chemin R2 incorrect au premier sync** : `rclone sync assets/
  :s3:bucket` place le *contenu* de `assets/` à la racine du bucket, mais
  le code (`html-require-loader.js`) attend les fichiers sous un préfixe
  `assets/` (il réécrit `/assets/...` → `<prefix>assets/...`, donc
  l'origine externe doit servir `assets/...`, pas juste `...`). Corrigé
  dans `sync-assets-r2.js` : sync vers `:s3:bucket/assets`
- **`wrangler pages deploy` déploie en Preview si le repo local n'est pas
  sur `main`** — le premier déploiement a silencieusement atterri sur une
  URL de branche (`feat-contest-gallery`) au lieu du domaine de
  production, sans erreur visible. Corrigé : `deploy-pages.js` passe
  toujours `--branch=main` explicitement, indépendamment de la branche
  git locale
- **Police `@font-face` non réécrite** : le template HTML de
  `webpack.prod.config.js` (`HtmlWebpackPlugin` → `templateContent`)
  référence `/assets/font/Exo-Regular.ttf` en dur, hors du mécanisme
  `<require>` de `html-require-loader.js` — jamais préfixé. Corrigé en
  interpolant `ASSET_PREFIX` directement dans le template literal JS du
  config webpack
- **`build-all.js`** : corrigé en amont (voir section "Fiabilité" plus
  haut), sinon un build silencieusement cassé aurait pu être déployé sans
  qu'on le sache

### Bugs supplémentaires trouvés après le premier "c'est bon" (test navigateur réel)

Le premier "c'est déployé, ça marche" (codes HTTP 200 via `curl`) s'est
avéré insuffisant à deux reprises — `curl` ne reproduit ni le
comportement de résolution des chemins relatifs, ni CORS. Chronologie :

1. **`ASSET_PREFIX` ne réécrit que les chemins dans des fichiers HTML
   inclus via `<require>`** — les chemins codés en dur dans des `.js`
   (ex: `src/components/shared/custom-hand-controls.js`) ou dans des
   `.html` hors `<require>` imbriqué ne sont **jamais** préfixés
2. **Bug plus profond dans `loaders/html-require-loader.js`** :
   - Avec `ASSET_PREFIX` **vide**, le `.replace(/\/assets\//g, ...)`
     s'exécutait quand même et **retirait le slash de tête** (`/assets/`
     → `assets/`) — transforme un chemin absolu en chemin *relatif à la
     page courante*. Résultat : `/dimetrodon/assets/images/loader.webp`
     au lieu de `/assets/images/loader.webp` (404, la scène cherche
     l'asset dans son propre sous-dossier)
   - Avec `ASSET_PREFIX` **plein** (`https://pub-xxx.r2.dev`), la
     normalisation forçait un slash de tête même sur une URL absolue,
     produisant `/https://pub-xxx.r2.dev/assets/...` (URL cassée,
     interprétée comme un chemin sur le domaine courant)
   - Fix (dans `loaders/html-require-loader.js`) : le `replace()` ne
     s'exécute que si un prefix est configuré, et une URL absolue
     (`http(s)://` ou `//`) n'est plus préfixée d'un `/`
   - Leçon générale : toujours vérifier avec `curl`/`grep` sur les
     **chaînes réellement présentes dans le bundle déployé** (pas des
     URLs reconstruites à la main) avant de valider
3. **CORS + redirect incompatibles pour un preflight** — en tentant un
   correctif alternatif (proxy `_redirects` vers R2 plutôt que patcher le
   loader), deux sous-bugs supplémentaires sont apparus :
   - Un rewrite **200** (transparent, même URL affichée) dans
     `_redirects` ne fonctionne que pour des chemins internes au même
     déploiement Pages — **pas** vers un domaine externe comme R2
   - Un vrai redirect **302** fonctionne pour une requête GET simple,
     mais **casse le preflight CORS** : Cloudflare Pages répond au
     preflight `OPTIONS` par... un 302 vers R2, et les navigateurs ne
     suivent **jamais** les redirections pour un preflight → la requête
     réelle est bloquée par CORS, même si R2 a `Access-Control-Allow-Origin: *`
     configuré correctement (vérifié indépendamment que R2 répond bien
     au preflight OPTIONS en direct — le problème était Pages, pas R2)

### Architecture finale retenue : Worker `_worker.js` + binding R2 (pas de CORS du tout)

Plutôt que continuer à rafistoler le proxy `_redirects`, la solution
robuste est de servir `/assets/*` **depuis la même origine** que le site
(`prehistoric-domain-vr.pages.dev`) via un Worker Cloudflare Pages
personnalisé connecté à R2 par binding — élimine le cross-origin
entièrement, donc plus besoin de CORS ni de redirect :

- **`_worker.js`** (racine du repo, copié dans `dist/` par
  `deploy-pages.js` avant chaque déploiement — `dist/` est reconstruit à
  chaque build donc rien n'y survit d'un déploiement à l'autre) :
  intercepte `/assets/*`, lit l'objet R2 via le binding `ASSETS_BUCKET`,
  le sert directement. Tout le reste retombe sur `env.ASSETS.fetch()`
  (assets statiques Pages normaux)
- **Cache Workers (`caches.default`)** intégré au Worker : le premier
  visiteur qui charge un asset le fait venir de R2, tous les suivants
  (n'importe où) sont servis depuis le cache edge Cloudflare le plus
  proche sans retoucher R2 — utile vu le volume d'assets lourds (.glb,
  textures). Le `?lastmod=` (cache-buster de build, `UNIQUE_ASSETS_ID`)
  sert aussi de clé de version : un nouveau déploiement invalide
  naturellement le cache
- **`wrangler.toml`** (racine du repo, committé — pas de secret dedans) :
  ```toml
  name = "prehistoric-domain-vr"
  pages_build_output_dir = "dist"
  compatibility_date = "2026-09-04"

  [[r2_buckets]]
  binding = "ASSETS_BUCKET"
  bucket_name = "prehistoric-domain-assets"
  ```
  Le binding R2 a été détecté et appliqué automatiquement par `wrangler
  pages deploy` (pas eu besoin de configuration dashboard manuelle)
- Build **sans** `--assetprefix` (vide) : tous les chemins restent
  `/assets/...` (absolus, same-origin) — c'est le Worker qui les
  résout côté serveur, plus besoin de préfixer vers un domaine externe
  au moment du build
- CORS sur le bucket R2 (`wrangler r2 bucket cors set`, cf.
  `r2-cors.json`) n'est **plus strictement nécessaire** avec cette
  architecture (plus de cross-origin), mais laissé actif — inoffensif, et
  utile si l'URL `pub-xxx.r2.dev` est encore utilisée ailleurs
- **Validé** : 365/366 assets réels testés (chemins extraits du bundle
  déployé, pas reconstruits à la main) sur 2 scènes différentes, tous les
  15 endpoints de scène en 200. Le seul échec (`/assets/images/gallery/1.jpg`)
  est un fichier qui n'existe pas non plus en local — bug pré-existant,
  sans rapport avec la migration

### Bug indépendant trouvé et corrigé : erreur runtime Three.js/A-Frame

En testant en navigateur (une fois les assets corrigés), une erreur JS
est apparue : `Cannot set property customDepthMaterial of #<fe> which
has only a getter`. Sans rapport avec R2/Pages/CORS — un problème de
dérive de version de dépendance :
- `package.json` fixait `"aframe": "^1.7.1"` (range souple), mais
  `1.8.0` était réellement installé — `aframe@1.8.0` dépend de
  `super-three@0.184.0` (fork three.js d'aframe) contre `0.173.5` pour
  `1.7.1`, un saut de 11 versions mineures qui a probablement introduit
  la régression
- Fix : `aframe` fixé à la version exacte `1.7.1` (pas de `^`) dans
  `package.json`, `npm install`, rebuild — `node_modules/aframe` embarque
  alors sa propre copie de `three@0.173.5`
  (`node_modules/aframe/node_modules/three`)

### Durcissement anti-abus (2026-09-05)
Suite à une question légitime sur le risque de facture en cas d'attaque
bot/trafic anormal :
- **R2 n'a pas de frais d'egress** (contrairement à AWS S3) — le pire cas
  reste borné aux Class B ops (`$0.36/million` au-delà de 10M/mois
  gratuits), pas une explosion de bande passante facturée
- **Faille corrigée dans `_worker.js`** : la clé de cache se basait sur
  l'URL complète (query string incluse) — un attaquant ajoutant un
  paramètre aléatoire (`?x=random`) à chaque requête aurait pu forcer un
  cache miss systématique, donc une vraie lecture R2 à chaque fois (le
  seul poste qui coûte réellement de l'argent ici). Fix : la clé de cache
  ne retient que le paramètre `lastmod` (celui qu'on contrôle, versioning
  de build) et ignore tout le reste — testé avec plusieurs query strings
  aléatoires, toujours 200
- **Recommandé côté Benjamin (dashboard, pas faisable par Claude)** :
  - Billing → Spending Limits : configurer un plafond de dépense
    (bloque le service plutôt que facturer au-delà)
  - Security → Bots → Bot Fight Mode (gratuit, un clic)
  - Vérifier que le plan Workers est bien resté "Free" (plafond dur de
    100k requêtes/jour, pas de facturation au-delà sur ce plan)

### Reste à faire (côté Benjamin)
- Vérifier le rendu réel des 15 scènes VR dans un navigateur — fait une
  première fois (a permis de trouver les bugs CORS + aframe ci-dessus),
  à refaire après le tout dernier déploiement pour confirmation finale
- Décider si un domaine custom pour R2 est souhaité à terme (pas
  nécessaire pour l'instant vu le volume de trafic, et plus la même
  urgence maintenant que le Worker sert tout en same-origin)
- Basculer les liens/intégrations pointant vers l'ancien hébergement
  Hostinger vers `https://prehistoric-domain-vr.pages.dev`
- Pour les prochains déploiements : `npm run build:all --assetprefix=`
  (vide) puis `npm run deploy:pages -- prehistoric-domain-vr` (copie
  `_worker.js` automatiquement) ; si de nouveaux/modifiés assets, lancer
  aussi `npm run sync:assets -- prehistoric-domain-assets` avant
- Ce document reste un doc de travail — à supprimer une fois son contenu
  repris dans le README (ou équivalent)
