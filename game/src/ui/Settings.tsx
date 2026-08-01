import { useState } from "react";
import { isMuted, toggleMuted } from "../audio/sound";
import { LANGS, LANG_NAMES, getLang, setLang, useT } from "./i18n";

/**
 * The two settings there are, bottom-left, in both the hub and a match.
 *
 * It replaces the lone mute button rather than sitting next to it. Two floating
 * circles in a corner is the beginning of a pile; one strip is a place settings
 * live, and the next one has somewhere to go.
 *
 * Language is shown as the languages themselves rather than as a dropdown or a
 * globe icon, for the obvious reason: somebody who cannot read the current
 * language cannot read a menu written in it either, but they can recognise
 * "한국어" and "English". Both are always spelled in their own language, which
 * is the convention every OS uses and the only one that works.
 */
export function Settings() {
  const t = useT();
  const [muted, setMuted] = useState(() => isMuted());
  const lang = getLang();

  return (
    <div className="settings">
      <button
        className="settings-btn"
        onClick={() => setMuted(toggleMuted())}
        aria-label={muted ? t("settings.soundOn") : t("settings.soundOff")}
        title={muted ? t("settings.soundOn") : t("settings.soundOff")}
      >
        {muted ? "🔇" : "🔊"}
      </button>

      <div className="settings-langs" role="group" aria-label={t("settings.language")}>
        {LANGS.map((l) => (
          <button
            key={l}
            className={"settings-lang" + (l === lang ? " is-on" : "")}
            onClick={() => setLang(l)}
            aria-pressed={l === lang}
          >
            {LANG_NAMES[l]}
          </button>
        ))}
      </div>
    </div>
  );
}
