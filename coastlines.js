/*
 * coastlines.js — Hurricane Console
 * Hand-simplified schematic coastlines for the Atlantic basin, [lon,lat] pairs.
 * Deliberately coarse (~0.5deg): the app draws these as vector polylines so the
 * map needs no external tile server (which the artifact sandbox blocked, and
 * which keeps the PWA fully offline-capable). Resolution matches the product.
 */
window.BASIN_COASTLINES = {
  type: 'FeatureCollection',
  features: [
    // --- North America: Gulf of America + Florida + US East Coast -----------
    { type: 'Feature', properties: { name: 'na-east' }, geometry: { type: 'LineString', coordinates: [
      [-97.1, 25.9], [-94.7, 29.3], [-91.2, 29.2], [-89.2, 29.1], [-88.0, 30.3],
      [-85.7, 30.1], [-84.0, 30.1], [-82.8, 27.8], [-81.8, 26.1], [-80.9, 25.2],
      [-80.1, 25.8], [-80.1, 27.0], [-80.6, 28.4], [-81.3, 29.9], [-81.4, 31.1],
      [-80.9, 32.0], [-79.2, 33.4], [-77.9, 34.0], [-76.0, 35.0], [-75.5, 35.6],
      [-76.3, 37.0], [-75.1, 38.0], [-74.0, 39.7], [-73.9, 40.6], [-72.1, 41.0],
      [-70.7, 41.6], [-70.0, 41.7]
    ] } },
    // --- Mexico / Central America / N South America -------------------------
    { type: 'Feature', properties: { name: 'ca-coast' }, geometry: { type: 'LineString', coordinates: [
      [-97.1, 25.9], [-96.1, 19.2], [-94.5, 18.2], [-91.5, 18.6], [-88.3, 18.5],
      [-87.5, 21.4], [-90.3, 21.0], [-90.5, 19.9], [-91.0, 18.7], [-88.9, 15.9],
      [-83.9, 15.0], [-83.2, 12.0], [-81.4, 8.9], [-78.8, 8.7], [-77.4, 8.5],
      [-76.8, 8.0], [-74.9, 11.0], [-71.7, 12.4], [-71.0, 11.6], [-68.4, 11.2],
      [-64.0, 10.6], [-61.9, 10.7], [-60.0, 9.0], [-58.0, 6.8], [-54.5, 5.6],
      [-51.7, 4.0], [-50.0, 2.0], [-48.6, -0.7]
    ] } },
    // --- Greater Antilles ---------------------------------------------------
    { type: 'Feature', properties: { name: 'cuba' }, geometry: { type: 'LineString', coordinates: [
      [-84.9, 21.9], [-82.7, 22.9], [-81.2, 23.2], [-79.3, 22.6], [-77.5, 21.6],
      [-75.7, 21.0], [-74.1, 20.3], [-77.7, 19.9], [-80.5, 20.0], [-82.9, 21.5], [-84.9, 21.9]
    ] } },
    { type: 'Feature', properties: { name: 'hispaniola' }, geometry: { type: 'LineString', coordinates: [
      [-74.4, 18.4], [-71.7, 19.9], [-69.3, 19.3], [-68.3, 18.6], [-71.6, 18.0], [-74.4, 18.4]
    ] } },
    { type: 'Feature', properties: { name: 'puerto-rico' }, geometry: { type: 'LineString', coordinates: [
      [-67.2, 18.5], [-65.6, 18.5], [-65.6, 17.9], [-67.2, 17.9], [-67.2, 18.5]
    ] } },
    { type: 'Feature', properties: { name: 'jamaica' }, geometry: { type: 'LineString', coordinates: [
      [-78.4, 18.5], [-76.2, 18.5], [-76.2, 17.7], [-78.4, 17.7], [-78.4, 18.5]
    ] } },
    // --- Lesser Antilles arc (schematic) ------------------------------------
    { type: 'Feature', properties: { name: 'lesser-antilles' }, geometry: { type: 'LineString', coordinates: [
      [-63.0, 18.2], [-61.8, 17.1], [-61.4, 15.4], [-61.1, 14.0], [-61.2, 13.2],
      [-61.5, 12.1], [-61.2, 10.7]
    ] } },
    // --- Bahamas (schematic scatter as a chain) -----------------------------
    { type: 'Feature', properties: { name: 'bahamas' }, geometry: { type: 'LineString', coordinates: [
      [-78.0, 26.7], [-77.2, 25.1], [-76.0, 24.3], [-74.5, 23.5], [-73.0, 22.4], [-71.5, 21.5]
    ] } },
    // --- West Africa --------------------------------------------------------
    { type: 'Feature', properties: { name: 'africa-west' }, geometry: { type: 'LineString', coordinates: [
      [-9.8, 31.8], [-13.0, 27.7], [-16.5, 23.0], [-16.9, 21.0], [-17.1, 18.0],
      [-16.5, 16.0], [-16.7, 13.5], [-15.5, 11.5], [-13.7, 9.5], [-11.5, 7.7],
      [-9.0, 5.9], [-6.5, 4.9], [-4.0, 5.2], [-1.0, 5.2], [2.0, 6.3], [5.0, 4.5],
      [8.5, 4.4], [9.4, 2.3], [9.3, 0.4]
    ] } }
  ]
};
if (typeof module !== 'undefined' && module.exports) module.exports = window.BASIN_COASTLINES;
