# Astra : voix dynamique FR / EN / DE

## État de cette livraison

Le kiosk conserve son lecteur audio unique, son déblocage par le clic du GM,
l’amplification, ses vidéos, son miroir, la reconnaissance et le changement de
langue, le mot de passe, les triggers et la synchronisation des parchemins.
La synthèse utilise ElevenLabs Flash v2.5. Aucun compte ni clé n’est créé par ce code.
**Sans configuration du proxy et code staff, le site continue avec ses MP3.**

Le catalogue contient 19 intentions / 22 fichiers par langue (66 entrées).
Les répliques sont de nouveaux textes éditables, pas des transcriptions des MP3.
Le proxy choisit le texte depuis `astra-responses.json`, puis le synthétise.
Il n’accepte ni texte libre, ni URL, ni voix/modèle choisis par le navigateur.
Ce changement ajoute une voix dynamique au détecteur existant, pas un chatbot généraliste.

Les séquences `mdp`, `notif`, `parchemin`, `indice_aide`, `mdp_oublie`, `rire` et
`berceuse` restent enregistrées : préserver les vrais indices, les scènes,
le rire et la musique évite de les remplacer par un texte inventé.
Tous les autres MP3 restent aussi présents comme secours en cas de panne.
Pour convertir une scène plus tard, ajouter son nom de fichier et **son texte exact**
dans le catalogue de chacune des trois langues puis redéployer le serveur.

## 1. Héberger le petit serveur sur Render

Le site public reste sur GitHub Pages. `render.yaml` décrit un service Docker
indépendant ; le conteneur ne contient que le serveur et le catalogue.

1. Sur [Render](https://dashboard.render.com/), choisir **New → Blueprint**,
   connecter le dépôt `Leconceptarium/astra-kiosk`, branche `main`, puis utiliser
   le fichier `render.yaml` à la racine.
2. Renseigner les variables privées demandées par le Blueprint :
   - `ELEVENLABS_API_KEY` : votre clé API ElevenLabs, avec droit de synthèse vocale.
     **C’est ici, dans Render, qu’il faut coller la clé secrète. Jamais dans GitHub,
     un fichier HTML/JS, le catalogue, une capture ou le champ de l’iPad.**
   - `ELEVENLABS_VOICE_ID` : l’identifiant de la voix choisie dans votre bibliothèque
     ElevenLabs. Choisir une voix autorisée sur votre compte et écouter FR/EN/DE.
     L’identifiant exact de la voix de la vidéo de référence n’est pas connu.
   - `ASTRA_ACCESS_CODE` : un code aléatoire distinct, d’au moins 32 caractères,
     généré par votre gestionnaire de mots de passe. Il sert uniquement au staff.
     Ce n’est ni la clé ElevenLabs ni le mot de passe du jeu.
3. Garder `ALLOWED_ORIGIN=https://leconceptarium.github.io`, sans `/astra-kiosk`
   et sans slash final. Si le site change de domaine, mettre son origine HTTPS exacte.
4. `DAILY_CHARACTER_LIMIT=20000` plafonne les caractères de synthèse par jour UTC
   **et par processus**. Le compte est en mémoire et repart à zéro au redémarrage.
   Garder une seule instance et configurer aussi une restriction de crédits sur
   la clé ElevenLabs ; le plafond en mémoire n’est pas une garantie de facturation.
5. Déployer, puis ouvrir `https://VOTRE-SERVICE.onrender.com/health` : réponse `ok`.

Pour modifier un secret après création : **Render Dashboard → service astra-voice
→ Environment → Edit → variable concernée → Save, rebuild, and deploy** (ou
l’option de sauvegarde avec redéploiement proposée dans l’interface).
Les variables `sync: false` du Blueprint sont saisies chez l’hébergeur : leur valeur
ne figure pas dans le dépôt. Ne pas utiliser GitHub Actions pour les injecter dans
le JavaScript. `astra.env.example` reste un exemple vide.

Le Blueprint utilise le plan gratuit. Un serveur endormi peut démarrer trop
lentement : le kiosk bascule alors en MP3 après environ 8 secondes de requête.
Ouvrir `/health` avant une session pour réveiller le serveur. Pour une exploitation
continue, évaluer un hébergement sans mise en veille ; aucune offre payante n’est
souscrite par cette livraison.

## 2. Activer sur le kiosk

Dans `astra-voice-config.js`, renseigner **uniquement l’URL publique du serveur** :

```js
window.ASTRA_VOICE_CONFIG = {
  endpoint: 'https://VOTRE-SERVICE.onrender.com'
};
```

Après publication GitHub Pages, recharger Astra sur l’iPad. Avant de choisir la
langue, ouvrir **Voix dynamique — réglage staff**, saisir `ASTRA_ACCESS_CODE`,
puis toucher FR, EN ou DE comme d’habitude. Le vrai geste du GM continue de
déverrouiller le lecteur et le micro Safari. Aucun appel de synthèse payant n’est
effectué lors du démarrage ni sur une transcription provisoire.

Le code staff est gardé seulement en mémoire dans cet onglet ; le champ est vidé
au lancement. Il faut le ressaisir après rechargement. Ne pas le publier dans
le fichier de configuration. Laisser le champ vide pour une session entièrement MP3.
La zone staff est masquée pendant la projection. Un message d’état y signale le
secours MP3. Recharger la page pour changer le code (réinitialise la partie).

## 3. Répliques, langue et qualité audio

Modifier `astra-responses.json` pour changer les textes, sans générer ni héberger
de nouveaux enregistrements. Les clés sont les noms MP3 du détecteur existant.
La langue vient de ce nom de fichier : une requête commencée en FR garde sa langue
même si la sélection change. Les doublons Pétunia ont leur propre réplique.
Redéployer le serveur après une modification pour vider son cache et publier les
nouveaux textes. Le même identifiant de voix est utilisé pour FR/EN/DE.

Le serveur produit du MP3 compatible Safari. Le navigateur reçoit le fichier
complet puis le joue par une URL temporaire sur **le même lecteur Audio**.
Cette URL est libérée en fin de lecture. Il ne s’agit pas de streaming phrase par
phrase : une première synthèse attend le réseau et ElevenLabs. Le cache du serveur
(maximum 16 Mio, mémoire seulement) accélère les suivantes et évite leur refacturation.
Le chargement du catalogue a un délai maximal de 2 secondes ; l’appel vocal 8 secondes.
Une panne, un quota atteint ou un code incorrect entraîne le MP3 d’origine.

## Sécurité et limites

- La clé ElevenLabs ne quitte le serveur que vers l’API HTTPS officielle.
- Authentification staff obligatoire en plus de l’origine autorisée. CORS seul
  n’est pas une authentification ; le code ne repose pas sur CORS seul.
- Catalogue fermé, requête de 1 Kio maximum, 120 demandes/minute pour le service,
  2 synthèses distinctes simultanées, requêtes identiques regroupées, quota caractères.
- Timeout fournisseur de 6,5 secondes, réponses audio limitées à 2 Mio, erreurs
  fournisseur masquées ; ni secrets ni transcriptions journalisés par le proxy.
- Le code staff autorise une consommation sur le proxy : le garder privé et le
  renouveler dans Render s’il est divulgué. Les appareils de confiance le connaissent.
- Le filtrage global protège les dépenses, mais une attaque peut rendre le proxy
  indisponible ; le kiosk possède le secours MP3. Pour plusieurs instances ou une
  exposition plus large, ajouter un quota partagé persistant et une protection en amont.
- Les MP3 restent nécessaires au secours : ne pas les supprimer.

## Tests et recette iPad

Node 24 suffit, aucune dépendance npm :

```sh
node --test astra-voice.test.mjs
```

Les tests couvrent syntaxe du kiosk, catalogue, auth/CORS, données invalides,
taille, trois langues, cache, paramètres ElevenLabs, erreurs/quota, attente de
synthèse, lecteur unique, répétition via le fichier d’origine, secours MP3 et
événements parchemin. Le fournisseur est simulé : aucun crédit utilisé.

À valider sur l’iPad physique après saisie des secrets :

1. Démarrer avec un code valide ; tester bonjour et une question en FR, EN, DE.
2. Vérifier voix, intonation, amplification et absence d’écoute de sa propre voix.
3. Valider le mot de passe : confirmation, transformation puis notification.
4. Demander le parchemin avant/après validation, puis demander de répéter.
5. Tester une blague et le rire qui suit ; les indices et la berceuse.
6. Tester un mauvais code et une panne du proxy en gardant GitHub Pages accessible :
   la réponse doit utiliser le MP3 et l’écoute doit reprendre.
7. Tester le retour de veille Safari et le geste de secours habituel.

Cette livraison ne certifie pas l’écoute réelle, le micro ni Safari iPadOS sans
test physique. Ni le backend distant ni la voix réelle ne peuvent être validés
avant configuration des secrets et de la voix.

## Retour arrière

Vider `endpoint` dans `astra-voice-config.js` ou lancer sans code staff rétablit les
réponses MP3. Le reste du jeu reste identique. Pour retirer toute l’intégration,
rétablir `index.html` depuis le commit précédent via l’historique GitHub.

## Documentation officielle

- [ElevenLabs : synthèse et paramètres](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- [Render : variables et secrets](https://render.com/docs/configure-environment-variables)
- [Render : Blueprint](https://render.com/docs/blueprint-spec)
