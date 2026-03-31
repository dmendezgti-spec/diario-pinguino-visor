const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR));

function isValidDateSlug(dateSlug) {
  return /^\d{2}-\d{2}-\d{4}$/.test(dateSlug);
}

function getPdfRelativePath(dateSlug) {
  const [day, month, year] = dateSlug.split('-');
  return path.posix.join('/ediciones', year, month, `${dateSlug}.pdf`);
}

function resolvePdfRelativePath(dateSlug) {
  const [day, month, year] = dateSlug.split('-');
  const monthDir = path.join(PUBLIC_DIR, 'ediciones', year, month);
  const exactRelativePath = getPdfRelativePath(dateSlug);
  const exactAbsolutePath = path.join(PUBLIC_DIR, exactRelativePath);

  if (fs.existsSync(exactAbsolutePath)) {
    return exactRelativePath;
  }

  if (!fs.existsSync(monthDir)) {
    return null;
  }

  const normalizedDate = `${day}-${month}-${year}`;
  const candidates = fs
    .readdirSync(monthDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name))
    .map((entry) => entry.name);

  const withDate = candidates.find((name) => name.includes(normalizedDate));
  if (withDate) {
    return path.posix.join('/ediciones', year, month, withDate);
  }

  if (candidates.length === 1) {
    return path.posix.join('/ediciones', year, month, candidates[0]);
  }

  return null;
}

app.get('/api/ediciones/recientes', (req, res) => {
  const edicionesDir = path.join(PUBLIC_DIR, 'ediciones');
  const ediciones = [];

  if (!fs.existsSync(edicionesDir)) {
    return res.json({ ok: true, ediciones });
  }

  const years = fs.readdirSync(edicionesDir)
    .filter((y) => fs.statSync(path.join(edicionesDir, y)).isDirectory())
    .sort((a, b) => b - a);

  for (const year of years) {
    const months = fs.readdirSync(path.join(edicionesDir, year))
      .filter((m) => fs.statSync(path.join(edicionesDir, year, m)).isDirectory())
      .sort((a, b) => b - a);

    for (const month of months) {
      const files = fs.readdirSync(path.join(edicionesDir, year, month))
        .filter((f) => /\.pdf$/i.test(f))
        .sort((a, b) => b.localeCompare(a));

      for (const file of files) {
        const slug = file.replace(/\.pdf$/i, '');
        ediciones.push({
          slug,
          pdfPath: `/ediciones/${year}/${month}/${file}`
        });
        if (ediciones.length >= 30) break;
      }
      if (ediciones.length >= 30) break;
    }
    if (ediciones.length >= 30) break;
  }

  return res.json({ ok: true, ediciones });
});

app.get('/api/ediciones/:fecha', (req, res) => {
  const { fecha } = req.params;

  if (!isValidDateSlug(fecha)) {
    return res.status(400).json({
      ok: false,
      error: 'Formato de fecha inválido. Usa DD-MM-AAAA.'
    });
  }

  const relativePdfPath = resolvePdfRelativePath(fecha);
  const exists = Boolean(relativePdfPath);

  return res.json({
    ok: true,
    fecha,
    pdfPath: relativePdfPath || '',
    disponible: exists
  });
});

app.get('/diario/hoy', (req, res) => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear());
  res.redirect(302, `/diario/${day}-${month}-${year}`);
});

app.get('/diario/:fecha', (req, res) => {
  const { fecha } = req.params;

  if (!isValidDateSlug(fecha)) {
    return res.status(400).send('Fecha inválida. Debe usar el formato DD-MM-AAAA.');
  }

  return res.sendFile(path.join(PUBLIC_DIR, 'diario.html'));
});

app.get('/visor', (req, res) => {
  return res.sendFile(path.join(PUBLIC_DIR, 'diario.html'));
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Diario digital disponible en http://localhost:${PORT}`);
});
