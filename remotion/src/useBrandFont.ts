import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";
import { BRAND_FONT_FAMILY } from "./layout";

/**
 * Load a brand's own typeface and hold the render until it is actually ready.
 *
 * The gate is the whole point. Remotion renders frames independently, and a
 * frame drawn before the face arrives silently falls back to the house font --
 * so without delayRender() the failure is not "the font didn't work", it is a
 * handful of frames scattered through the video in the wrong typeface. That is
 * the hardest kind of defect to notice in review and the easiest to ship.
 *
 * Registered across the full weight range on purpose. The components ask for
 * 700; if the face declared only its own weight, Chrome would synthesise a
 * bold on top of a file that is very likely already bold, and the text would
 * render smeared. A brand supplies the weight it wants in the file itself.
 *
 * A font that fails to load calls cancelRender rather than continuing: the
 * brand asked for this typeface, and quietly shipping a video in a different
 * one is worse than stopping with the reason.
 */
export const BRAND_FONT_NAME = "BrandFont";

export function useBrandFont(fontPath?: string | null): string {
  const [handle] = useState(() => delayRender("Loading the brand font"));

  useEffect(() => {
    if (!fontPath) {
      continueRender(handle);
      return;
    }
    const face = new FontFace(BRAND_FONT_NAME, `url(${staticFile(fontPath)})`, {
      weight: "100 900",
    });
    face
      .load()
      .then((loaded) => {
        // Cast because this project's `lib: ["DOM", "ES2018"]` predates
        // FontFaceSet being typed as a Set. The call is standard and Chrome
        // has implemented it for years; widening `lib` to fix one line would
        // quietly admit newer APIs everywhere else in the codebase.
        (document.fonts as unknown as { add(f: FontFace): void }).add(loaded);
        continueRender(handle);
      })
      .catch((err) => {
        cancelRender(
          new Error(
            `Could not load the brand font at "${fontPath}": ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
      });
  }, [fontPath, handle]);

  // The house font stays on as the fallback in the stack, so a glyph the
  // brand's file lacks (Vietnamese diacritics are the realistic case) is drawn
  // by Oswald rather than by whatever the browser picks.
  return fontPath ? `${BRAND_FONT_NAME}, ${BRAND_FONT_FAMILY}` : BRAND_FONT_FAMILY;
}
