function formatDateSlug(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}-${month}-${year}`;
}

function formatDateHuman(date) {
  return new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

function buildEditionNumber(date) {
  const number = String(getDayOfYear(date)).padStart(3, '0');
  return `N. Edicion ${number}`;
}

(function initHome() {
  const now = new Date();
  const dateSlug = formatDateSlug(now);

  const dateLabelElement      = document.getElementById('fecha-hoy');
  const readLinkElement       = document.getElementById('leer-edicion-link');
  const downloadLinkElement   = document.getElementById('descargar-edicion-link');
  const editionNumberElement  = document.getElementById('numero-edicion');
  const editorialYearElement  = document.getElementById('ano-editorial');
  const publicationStateElement = document.getElementById('estado-publicacion');
  const recentListElement     = document.getElementById('recent-editions-list');

  if (dateLabelElement) {
    dateLabelElement.textContent = formatDateHuman(now);
  }

  if (readLinkElement) {
    readLinkElement.href = `/diario/${dateSlug}`;
  }

  if (editionNumberElement) {
    editionNumberElement.textContent = buildEditionNumber(now);
  }

  if (editorialYearElement) {
    editorialYearElement.textContent = `Ano editorial ${now.getFullYear()}`;
  }

  // Verify today's edition exists and update state
  fetch(`/api/ediciones/${dateSlug}`)
    .then((r) => r.json())
    .then((data) => {
      if (data.disponible) {
        if (downloadLinkElement) {
          downloadLinkElement.href = data.pdfPath;
          downloadLinkElement.style.display = '';
        }
        if (publicationStateElement) {
          publicationStateElement.textContent = 'Estado: Publicada';
          publicationStateElement.classList.add('is-live');
        }
      } else {
        if (downloadLinkElement) {
          downloadLinkElement.style.display = 'none';
        }
        if (readLinkElement) {
          readLinkElement.style.opacity = '0.45';
          readLinkElement.style.pointerEvents = 'none';
        }
        if (publicationStateElement) {
          publicationStateElement.textContent = 'Estado: Pendiente de publicacion';
          publicationStateElement.classList.remove('is-live');
        }
      }
    })
    .catch(() => {});

  // Load recent editions list dynamically
  if (recentListElement) {
    fetch('/api/ediciones/recientes')
      .then((r) => r.json())
      .then((data) => {
        if (!data.ediciones || data.ediciones.length === 0) {
          return;
        }
        recentListElement.innerHTML = '';
        // Skip today (already shown in hero)
        const others = data.ediciones.filter((e) => e.slug !== dateSlug);
        others.slice(0, 10).forEach((ed) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = `/diario/${ed.slug}`;
          a.textContent = ed.slug;
          li.appendChild(a);
          recentListElement.appendChild(li);
        });
      })
      .catch(() => {});
  }
})();
