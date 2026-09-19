# MerylCarPlayer V0.53 — Android Studio

Base de développement de MerylCarPlayer V0.53.

## Ouvrir dans Android Studio
1. Android Studio > Open
2. Choisir le dossier `MerylCarPlayer_V0.53_ANDROID_STUDIO`
3. Attendre la synchronisation Gradle
4. Brancher le téléphone en USB
5. Cliquer sur Run ▶

## Configuration
- Version : 0.53
- applicationId : com.nik.roadplayer
- minSdk : 29
- targetSdk / compileSdk : 36
- Java / Kotlin JVM : 17

## V0.52
- Le widget conserve le dernier morceau affiché lorsqu'on arrête la lecture.
- Pochette, artiste, album et titre restent visibles jusqu'au changement de morceau dans MerylCarPlayer.

## V0.52
- Le bandeau sous le logo est rouge (#FF3131) pour confirmer visuellement que la mise à jour est installée.
- Une commande STOP externe est convertie en PAUSE afin de conserver le morceau et ses métadonnées dans le lecteur principal.

## V0.53
- En mode Artistes, une seule pochette est affichée par artiste.
- Double appui sur la pochette : affiche tous les albums de cet artiste.
- Dans la vue artiste ouverte, un appui simple sur une pochette ouvre/lit l'album.
- Retour Android : revient à la liste des artistes.
