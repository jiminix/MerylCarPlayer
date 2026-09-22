# MerylCarPlayer V0.87 — Android Studio

Version 0.87 : Mini Studio à trois pistes (pistes 1, 2 et 3) et métronome lumineux TAP TEMPO.

- Touchez plusieurs fois la grande lumière au tempo voulu : le rythme est estimé sur les derniers taps et affiché en BPM (30–300).
- La lumière clignote à chaque battement ; le bouton PAUSE / MARCHE contrôle le métronome.
- Le métronome est uniquement visuel : aucun clic n'est enregistré ni ajouté à l'export audio.
- Les anciens fichiers de pistes 4 et 5 ne sont pas effacés lors de la mise à jour, mais ils ne sont plus lus ni mixés.

## Compilation

Le workflow GitHub Actions `.github/workflows/android-debug.yml` compile l'APK de test à chaque push sur `main`.
La signature de débogage reste celle de la version précédente pour permettre une installation par-dessus, sous réserve que le cache de signature soit disponible.
