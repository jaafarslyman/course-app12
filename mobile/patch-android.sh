set -e
APP=android/app/src/main

# 1) Turn on FLAG_SECURE natively (blocks screenshots + screen recording)
MA=$(find "$APP/java" -name 'MainActivity.*' | head -1)
DIR=$(dirname "$MA")
rm -f "$MA"
cat > "$DIR/MainActivity.java" <<'JAVA'
package com.englishwithali.secure;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    getWindow().setFlags(
      WindowManager.LayoutParams.FLAG_SECURE,
      WindowManager.LayoutParams.FLAG_SECURE
    );
    super.onCreate(savedInstanceState);
  }
}
JAVA

# 2) Use the book icon as the launcher icon
SRC=../artifacts/course-app/public/icon-512.png
find "$APP/res" -name 'ic_launcher*' -delete
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  d=${pair%%:*}; s=${pair##*:}
  mkdir -p "$APP/res/mipmap-$d"
  convert "$SRC" -resize ${s}x${s} "$APP/res/mipmap-$d/ic_launcher.png"
  convert "$SRC" -resize ${s}x${s} "$APP/res/mipmap-$d/ic_launcher_round.png"
done
