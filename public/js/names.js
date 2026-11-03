// Display names for stops and stations. The GTFS names come in odd casing
// ("Corinthians-itaquera", "Área De Desembarque"); this module is pure so Node tests it.

const CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * Capitalises each word and the word after a hyphen or slash, keeping Portuguese
 * connectors lowercase except at the start. The rest of each word is left as it is,
 * so acronyms ("USP", "C/B") survive.
 */
export function titleCase(name) {
  let first = true;
  return String(name).replace(/[^\s\-/(]+/g, (w) => {
    const lower = w.toLowerCase();
    const out = !first && CONNECTORS.has(lower) ? lower : w.charAt(0).toUpperCase() + w.slice(1);
    first = false;
    return out;
  });
}

/**
 * Renames, in place, the stop names of a raptor network (`names`, `lat`, `lon` are its
 * parallel arrays): rail stops take the name of the nearest station on the same line
 * (within `maxMeters`) from rail.geojson; every other stop gets titleCase().
 * `railRefs` maps a stop index to the Set of rail line refs that call there.
 */
export function applyDisplayNames(names, lat, lon, railRefs, railGeo, maxMeters = 400) {
  const stations = railGeo.features
    .filter((f) => f.properties?.kind === 'station' && f.properties.name)
    .map((f) => ({ name: f.properties.name, refs: f.properties.refs ?? [], lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
  for (let s = 0; s < names.length; s++) {
    const refs = railRefs.get(s);
    let best = null;
    if (refs) {
      let bestD = maxMeters;
      const k = Math.cos((lat[s] * Math.PI) / 180);
      for (const st of stations) {
        if (!st.refs.some((r) => refs.has(r))) continue;
        const d = Math.hypot((st.lat - lat[s]) * 111320, (st.lon - lon[s]) * 111320 * k);
        if (d < bestD) { bestD = d; best = st.name; }
      }
    }
    names[s] = best ?? titleCase(names[s]);
  }
}
