import JSZip from "jszip";

export async function zipTextFiles(fileMap /* array of {name, text} */) {
  const zip = new JSZip();
  for (const f of fileMap) zip.file(f.name, f.text);
  return zip.generateAsync({ type: "blob" });
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
