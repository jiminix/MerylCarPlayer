# REPRISE MerylCarPlayer 1.41 — 9 novembre 2026

## Objectif et règles NON NÉGOCIABLES
L'utilisateur veut reprendre le développement de MerylCarPlayer **1.41** dans un nouveau chat sans répéter l'historique, conserver la même installation 1.41 à chaque future mise à jour, et terminer cette semaine (avec un PC) l'import des **records** depuis 1.39. Ne jamais désinstaller ou écraser 1.39 et 1.40 avant migration et validation des données. 1.41 doit être une application Android **indépendante** des deux anciennes.

## GitHub / état précis
Dépôt : https://github.com/jiminix/MerylCarPlayer
Branche de travail **prepare-v1.41**, créée depuis main le 9 novembre 2026.
Commit de préparation Gradle : bcc7beaf647179c61a67b1f9f88d9863085e6c45.
Sur cette branche, app/build.gradle.kts :
- namespace = com.nik.roadplayer (NE PAS confondre avec applicationId)
- applicationId = com.nik.roadplayer.v141 (**à garder définitivement pour les futures mises à jour 1.41**)
- versionCode = 141, versionName = 1.41 ; pour les mises à jour suivantes augmenter versionCode sans changer applicationId ni signature.
- compileSdk 36, minSdk 29, targetSdk 36 ; Kotlin + Jetpack Compose, Media3.
Sur main, Gradle était encore versionCode 138/versionName 1.38 et applicationId com.nik.roadplayer.test : ne pas supposer que main contient tout le code des APK 1.39/1.40. Comparer les fonctionnalités avant d'effacer quoi que ce soit.

## SIGNATURE ANDROID — PROBLÈME PRIORITAIRE
Workflow main .github/workflows/android-debug.yml ; copie initiale héritée par prepare-v1.41.
Ancien cache actions/cache@v4 key merylcarplayer-debug-signing-v1, path ~/.android/debug.keystore, alias androiddebugkey, passwords android.
Build réussi du 3 nov : run 41622356075, job 125870987340, le cache était présent, APK artifact ID 13224721025. Build du 9 nov : runs 42682736908 et 42684741077, cache **absent**. Ancien workflow créait une clé de remplacement, dangereuse. Sur main, correctif de sécurité commit 82348597e4bd6c22f5b44e1ada1a3a2be0c07d16 : fail closed si cache absent, ne crée plus de clé. La branche prepare-v1.41 est née APRÈS ce correctif et l'hérite. Donc build 1.41 échouera tant qu'aucune clé n'est configurée.
**Pour une NOUVELLE app indépendante 1.41**, on PEUT générer UNE nouvelle clé dédiée, mais IL FAUT sauvegarder le keystore de manière durable (secret GitHub Actions base64 ou stockage privé chiffré) AVANT d'autoriser le premier build installable. Ne pas mettre la clé privée dans le repo ni logs/artifacts publics. Adapter le workflow pour lire le secret, vérifier SHA-256 du certificat et échouer s'il manque ; ne jamais régénérer automatiquement. Conserver les credentials. Les futures versions doivent être signées par la même clé.
Deux APK antérieures 1.39 et build du 3 novembre ont des certificats différents, donc pas de mise à jour croisée. L'utilisateur a les versions 1.39 ET 1.40 installées et veut les préserver jusqu'à la migration. Le fichier uploadé MerylCarPlayer TEST-1.39.apk peut servir à analyse, mais **n'est pas** la cible.
ATTENTION : le SHA256 du ZIP artifact n'est PAS l'empreinte du certificat Android. Ne pas confondre.
## ÉCHEC COMPILATION À CORRIGER
Logs run 42684741077 job 129388430231 : task :app:mergeDebugResources échoue car chemin `app/src/main/res/drawable/Bando haut.png` invalide (majuscule et espace). Autre fichier suspect `app/src/main/res/drawable/Bando Appli_20261011_001040_0000.png`. Renommer en minuscules et underscores, mettre à jour toute référence si nécessaire ; vérifier ressources et reconstruire.
## ARCHITECTURE ET FONCTIONS
Code source Kotlin dans app/src/main/java/com/nik/roadplayer/ ; MainActivity.kt, MusicRepository.kt (scan SD / cache / playlists / pochettes), PlaybackService.kt (Media3), StudioScreen.kt (Mini Studio 3 pistes), MerylPlayerWidget.kt, MerylBanners.kt. App musicale automobile. Caches locaux connus roadplayer_tag_cache_v1.json et roadplayer_track_index_v1.json ; préserver les données utilisateur. Lire les fichiers réels avant modification, ne pas présumer que les APK 1.39/1.40 sont exactement reproduites par main.
Workflow Android GitHub Actions assembleDebug et upload artifact "Meryl Car Audio" (APK "Meryl Car Audio.apk"). Pour 1.41 préférer un artifact clairement nommé.
## MIGRATION RECORDS
L'utilisateur prévoit de travailler cette semaine avec un PC pour transférer les records de 1.39 vers 1.41 (précédemment envisagé 1.39 -> 1.40). Avant d'agir, identifier le format réel et l'emplacement des records, la méthode d'export/import et si une version intermédiaire est nécessaire. Ne pas inventer de schéma ni effacer 1.39/1.40. Vérifier l'import sur 1.41, intégrité et nombre de records avant toute désinstallation.
## Prochaines actions concrètes
1. Inspecter code/ressources et renommer les images invalides.
2. Établir une signature durable pour la NOUVELLE application 1.41 (secret GitHub sécurisé, pas de génération éphémère). Faire participer l'utilisateur seulement si accès aux secrets requis.
3. Compiler/tester l'APK 1.41 sur la branche prepare-v1.41, contrôler applicationId, versionCode et certificat.
4. Donner lien de téléchargement de l'APK réellement créée. Ne pas dire qu'elle est prête avant un build réussi.
5. Faire installer 1.41 à côté de 1.39 et 1.40 ; valider fonctions et données.
6. Sur PC, préparer et exécuter import des records 1.39 -> 1.41. Préserver les deux anciennes installations jusqu'à validation.
7. Documenter signature (empreinte publique uniquement), version, commits, workflows, étapes pour reprendre dans tout nouveau chat.

## Prompt de reprise
« Reprends MerylCarPlayer 1.41 depuis https://github.com/jiminix/MerylCarPlayer branche prepare-v1.41 et lis REPRISE_MERYLCARPLAYER_1.41.md. Corrige la compilation, sécurise la clé de signature 1.41 pour des mises à jour sans réinstallation, construis l'APK, puis prépare l'import des records de 1.39 vers 1.41. Ne touche pas aux installations 1.39/1.40. »

## MISE À JOUR 9 novembre — signature 1.41 préparée
Commit workflow 57fb343b07dec5133344b7a2acd5fb239a94f26a sur prepare-v1.41. Un NOUVEAU keystore dédié 1.41 a été généré hors GitHub et livré à l'utilisateur en téléchargement ; ne JAMAIS le committer ni le publier. Alias androiddebugkey, storepass/keypass android (à terme remplacer par secrets dédiés si souhaité). Certificat SHA-256 attendu : 09:70:9D:46:7E:53:57:C5:58:83:92:27:13:1A:24:75:62:82:33:D5:10:F4:71:18:B5:A6:87:F2:DF:CD:43:7F. Le workflow refuse de construire si le secret GitHub **MERYL_141_KEYSTORE_BASE64** est absent ou si le certificat ne correspond pas. Il renomme à la volée les deux drawables aux noms invalides avant Gradle. Artifact prévu : MerylCarPlayer-1.41. **ACTION UTILISATEUR REQUISE** : GitHub dépôt > Settings > Secrets and variables > Actions > New repository secret, nom MERYL_141_KEYSTORE_BASE64, valeur contenu intégral du fichier GITHUB_SECRET_MERYL_141_KEYSTORE_BASE64.txt remis en téléchargement. Garder une copie sûre du fichier MerylCarPlayer-1.41.keystore. Puis lancer Actions > Build Meryl Car Audio APK > Run workflow sur branche prepare-v1.41. Ne pas confondre la branche avec main. Vérifier compilation et signature avant installation. La 1.41 n'est PAS encore construite/installable.

## 9 novembre 2026 — Relance après ajout du secret
L'utilisateur confirme avoir ajouté MERYL_141_KEYSTORE_BASE64 aux GitHub Actions secrets. Nouveau commit sur prepare-v1.41 pour déclencher automatiquement le workflow sur push. Vérifier le résultat de cette exécution avant de donner un lien APK.

## Nouveau test du secret
L'utilisateur confirme que MERYL_141_KEYSTORE_BASE64 apparaît dans Repository secrets. Nouveau build déclenché par ce commit pour vérifier son accessibilité.
