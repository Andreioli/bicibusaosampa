import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDisplayNames, titleCase } from '../public/js/names.js';

test('titleCase capitalises after hyphens and keeps connectors lowercase', () => {
  assert.equal(titleCase('Corinthians-itaquera'), 'Corinthians-Itaquera');
  assert.equal(titleCase('Bruno Covas-mendes-vila Natal'), 'Bruno Covas-Mendes-Vila Natal');
  assert.equal(titleCase('Área De Desembarque'), 'Área de Desembarque');
  assert.equal(titleCase('de Gaulle e dos Santos'), 'De Gaulle e dos Santos');
  assert.equal(titleCase('Parada 2 - José Maria Lisboa C/B'), 'Parada 2 - José Maria Lisboa C/B');
});

test('rail stops take the official station name, others are title-cased', () => {
  const railGeo = { features: [{ properties: { kind: 'station', name: 'Corinthians-Itaquera', refs: ['3', '11'] }, geometry: { coordinates: [-46.4713, -23.5420] } }] };
  const names = ['Corinthians-itaquera', 'Corinthians-itaquera', 'Área De Desembarque'];
  const lat = [-23.54199, -23.6, -23.5], lon = [-46.47127, -46.47127, -46.47];
  applyDisplayNames(names, lat, lon, new Map([[0, new Set(['3'])], [1, new Set(['3'])]]), railGeo);
  assert.deepEqual(names, ['Corinthians-Itaquera', 'Corinthians-Itaquera', 'Área de Desembarque']);
});
