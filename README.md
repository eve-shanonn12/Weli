# Weli-Link Market

Marketplace Web hybride de Weli-Link Market : les pages sont servies par le backend, puis le navigateur charge les données réelles via l’API. Il couvre le catalogue de vivres frais et de produits transformés, la disponibilité, les commandes d’achat, les notifications, les abonnements push et l’assistant Weli.

Ce n’est donc pas un simple site vitrine statique. L’accueil reste léger et rapide, tandis que les données, la connexion, les commandes, les décisions producteur, les notifications et le suivi de réception sont gérés côté serveur. Le règlement et la livraison se font directement entre acheteur et producteur, hors plateforme.

## Archive complète et démarrage rapide

L’archive contient le frontend, le backend Node.js, Prisma, la base SQLite `prisma/dev.db`, le logo, les données de démonstration et les dépendances déjà installées (`node_modules`). Après extraction, gardez tous les dossiers ensemble et double-cliquez sur `START-WELILINK.bat`, ou exécutez :

```powershell
npm run build
npm start
```

Le site sera disponible sur `http://127.0.0.1:3333`. Node.js doit être installé sur l’ordinateur. Si le dossier `node_modules` a été retiré lors d’un partage, exécutez `npm ci` une seule fois avant de démarrer. La base de démonstration est déjà dans `prisma/dev.db` : ne la supprimez pas si vous souhaitez conserver les comptes, annonces, demandes et conversations créés localement.

## Démarrer en local

```powershell
npm install
Copy-Item .env.example .env
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

L’API écoute par défaut sur `http://127.0.0.1:3333`.

Comptes de démonstration après le seed :

- acheteur : `+237690000001`
- producteur : `+237690000002`
- administrateur : `+237690000003`
- mot de passe : `Welilink123!`

## Routes principales

- `POST /api/auth/register` et `POST /api/auth/login`
- `GET /api/products` et `GET /api/products/:id`
- `GET /api/products/:id/image` — image stockée, visible pour une offre active ou son producteur/admin
- `POST /api/products` — producteur/admin, JSON conservé ou formulaire `multipart/form-data` avec `image`
- `POST /api/products/:id/image` et `DELETE /api/products/:id/image` — remplacement/suppression de la photo du producteur
- `PATCH /api/products/:id/stock` — mise à jour de stock
- `POST /api/products/:id/requests` — demande d’achat
- `GET /api/requests/mine` — demandes de l’acheteur
- `GET /api/requests/received` — demandes reçues par le producteur
- `PATCH /api/requests/:id/status` — acceptation ou refus
- `POST /api/requests/:id/cancel` — annulation par l’acheteur avant confirmation
- `POST /api/requests/:id/cancellation` — demande d’annulation motivée avec justificatif
- `PATCH /api/requests/:id/cancellation` — décision du producteur sur l’annulation
- `POST /api/requests/:id/confirm-receipt` — confirmation de réception et déduction du stock
- `POST /api/assistant/chat` — réponse de disponibilité basée sur le catalogue réel
- `GET /api/assistant/history` — historique persistant de la conversation Weli
- `GET /api/dashboard/producer` et `GET /api/dashboard/admin` — données des espaces par rôle
- `GET /api/notifications` et `PATCH /api/notifications/:id/read`
- `POST /api/notifications/push-subscriptions`

Pages Web principales : `/`, `/catalogue`, `/produit/:id`, `/assistant`, `/connexion`, `/inscription`, `/acheteur`, `/producteur`, `/admin` et `/notifications`.

## Photos des produits

Le formulaire producteur accepte une photo principale JPG, PNG ou WebP de 5 Mo maximum. Elle est prévisualisée dans le navigateur, puis envoyée au backend ; la clé Supabase ne quitte jamais le serveur. Le backend vérifie le rôle et le `producerId` avant chaque ajout, remplacement ou suppression. La colonne existante `Product.imageUrl` conserve le chemin Storage, sans nouvelle table ni doublon. Les images locales fournies restent le fallback visuel tant qu’une photo n’est pas associée.

## Préparation Supabase

La migration Supabase a été effectuée. Le schéma PostgreSQL actif est conservé dans `prisma/schema.prisma`, tandis que `prisma/schema.sqlite.prisma` garde une copie de secours du schéma local.

1. Dans le tableau de bord Supabase, ouvrez **Connect** et copiez une URL PostgreSQL de session (pour l’application) et l’URL directe (pour le schéma et la migration). Remplacez uniquement les valeurs locales dans `.env` :

   ```env
   SUPABASE_DATABASE_URL="postgresql://..."
   SUPABASE_DIRECT_URL="postgresql://..."
   SUPABASE_URL="https://<project-ref>.supabase.co"
   SUPABASE_SECRET_KEY="sb_secret_..."
   SUPABASE_STORAGE_BUCKET="product-images"
   ```

   Ne mettez jamais ces valeurs dans le frontend, Git ou un message. La clé `SUPABASE_SECRET_KEY` est strictement serveur.

2. Sur une base Supabase vide, exécutez :

   ```powershell
   npm run db:supabase:validate
   npm run db:supabase:push
   npm run db:migrate:supabase
   ```

3. Dans le SQL Editor Supabase, exécutez [`supabase/product-image-storage.sql`](supabase/product-image-storage.sql), puis associez les images locales correspondantes :

   ```powershell
   npm run db:associate-images
   ```

4. Gardez SQLite actif jusqu’à la vérification des comptes, offres, demandes, conversations, images et paiements. Après cette vérification, renseignez dans `.env` `DATABASE_URL` avec l’URL de session Supabase et `DIRECT_URL` avec l’URL directe, puis lancez :

   ```powershell
   npm run db:activate:supabase
   npm run db:generate
   npm run build
   npm start
   ```

   Le script conserve automatiquement une copie de l’ancien schéma dans `prisma/schema.sqlite.prisma` ; il ne supprime aucune donnée.
   Pour revenir au schéma local avant une nouvelle tentative, utilisez `npm run db:restore:sqlite` puis remettez `DATABASE_URL="file:./dev.db"`.

La base Supabase est maintenant opérationnelle pour cette installation. Les données locales ont été importées et les images associées sont stockées dans le bucket privé `product-images`. L’application utilise la connexion directe côté serveur car le pooler local retournait une erreur d’authentification.

## Weli, l’assistant conversationnel

Chaque conversation Weli est enregistrée dans SQLite (`ChatConversation` et `ChatMessage`). Les prix, lieux, quantités et états de stock transmis à l’IA viennent du catalogue réel : Weli ne doit jamais inventer une offre, un prix ou une disponibilité.

Pour activer la formulation par une vraie IA générative, ajoutez une clé Gemini uniquement côté serveur dans `.env` :

```env
GEMINI_API_KEY="votre-cle-api"
GEMINI_MODEL="gemini-3.5-flash-lite"
GEMINI_TIMEOUT_MS=12000
GEMINI_MAX_OUTPUT_TOKENS=220
ASSISTANT_RATE_LIMIT_MAX=8
ASSISTANT_RATE_LIMIT_WINDOW_MS=your_window_in_ms
```

L’application charge `.env` côté serveur. Le chat utilise le SDK officiel Gemini et son API Interactions avec `store: false`. Le modèle par défaut, `gemini-3.5-flash-lite`, privilégie la rapidité et le coût pour ce chat de disponibilité ; il reste configurable par `GEMINI_MODEL`. Si la clé, le quota ou le service ne sont pas disponibles, l’interface affiche une erreur réessayable au lieu de simuler une réponse IA. La clé ne doit jamais être exposée dans le HTML, dans le navigateur ou dans Git. Les messages sont limités à 500 caractères et l’endpoint applique une limite locale par utilisateur ou visiteur.

## Espaces connectés

- visiteur : accueil, catalogue, Weli et création/connexion ; aucun tableau de bord avant connexion ;
- producteur : publier des offres, mettre à jour le stock, répondre aux demandes et interroger Weli ;
- administrateur : supervision des utilisateurs, offres, alertes de disponibilité, demandes et paiements. L’inscription publique ne crée pas de compte administrateur.

## Règle de disponibilité

Une annonce renvoie un état `AVAILABLE`, `LOW_STOCK`, `CHECK_REQUIRED`, `OUT_OF_STOCK` ou `PAUSED`. Pour les produits frais, le stock doit être rafraîchi dans la fenêtre `FRESH_STOCK_TTL_HOURS`; pour les produits transformés, la fenêtre est `PROCESSED_STOCK_TTL_HOURS`. Une demande ne peut pas réserver un stock périmé ou insuffisant.

Le job d’expiration s’exécute toutes les minutes en production locale : il libère les réservations des demandes non traitées à temps et avertit l’acheteur. L’assistant répond avec une formulation prudente et demande une confirmation producteur lorsque le stock est trop ancien; il ne promet donc pas une quantité qui n’est pas vérifiée.

Le webhook de paiement est volontairement un adaptateur interne : il faudra le connecter au prestataire Mobile Money choisi et remplacer `PAYMENT_WEBHOOK_SECRET` par un secret de production.
