// Two runs of the same page differ a little in the edges of lines and text,
// because of how the browser antialiases and composites them. A person cannot
// see that, so it is not worth a commit. samePicture() compares only pixels, so
// it needs no change when the frame's design changes. A picture has changed when
// any pixel differs strongly, as new text or an icon does, or when faint
// differences cover a real area, as a new colour does.
const noise = 2;
const strong = 32;
const faintShare = 0.001;

export async function samePicture(page, before, after) {
  const uri = (png) => `data:image/png;base64,${png.toString("base64")}`;
  return page.evaluate(
    async ({ before, after, noise, strong, faintShare }) => {
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
      let faint = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        const difference = Math.max(
          Math.abs(a.data[i] - b.data[i]),
          Math.abs(a.data[i + 1] - b.data[i + 1]),
          Math.abs(a.data[i + 2] - b.data[i + 2]),
          Math.abs(a.data[i + 3] - b.data[i + 3]),
        );
        if (difference > strong) return false;
        if (difference > noise) faint++;
      }
      return faint <= a.width * a.height * faintShare;
    },
    { before: uri(before), after: uri(after), noise, strong, faintShare },
  );
}
