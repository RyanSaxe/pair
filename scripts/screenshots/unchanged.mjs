// Two runs of the same page can differ by a colour level or two in a few
// pixels, because of how the browser antialiases and composites. A person
// cannot see that, so it is not worth a commit. samePicture() compares only
// pixels, so it needs no change when the frame's design changes. A difference
// it misses costs nothing, because the next real change rewrites the PNG.
const noise = 2;

export async function samePicture(page, before, after) {
  const uri = (png) => `data:image/png;base64,${png.toString("base64")}`;
  return page.evaluate(
    async ({ before, after, noise }) => {
      const pixels = async (source) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const [a, b] = await Promise.all([pixels(before), pixels(after)]);
      if (a.width !== b.width || a.height !== b.height) return false;
      return a.data.every((value, i) => Math.abs(value - b.data[i]) <= noise);
    },
    { before: uri(before), after: uri(after), noise },
  );
}
