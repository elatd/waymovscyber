// Procedural San Francisco landmarks for WAYMO vs CYBERTAXI.
//
// Conventions (all factories):
//  - returns a THREE.Group, metres, +Y up, origin at the ground-level centre of
//    the footprint (y = 0 = ground/sidewalk, or the water surface for things in water)
//  - "front" faces +Z unless noted in LANDMARK_INFO
//  - group.userData.colliders: [{ x, z, hx, hz, h }] axis-aligned boxes in local XZ
//  - group.userData.nightMaterials: materials with emissiveIntensity = 0 by day and the
//    desired night value in material.userData.nightIntensity (lerp it yourself)
//  - textures are canvas-generated lazily in the browser; under Node they are skipped

export { createGoldenGateBridge, goldenGateCableY, GOLDEN_GATE } from './goldenGateBridge.js';
export { createBayBridge, bayBridgeCableY, BAY_BRIDGE } from './bayBridge.js';
export { createAlcatraz, animateAlcatraz, ALCATRAZ } from './alcatraz.js';
export { createTransamericaPyramid, TRANSAMERICA } from './transamericaPyramid.js';
export { createSalesforceTower, SALESFORCE } from './salesforceTower.js';
export { createCoitTower, COIT_TOWER } from './coitTower.js';
export { createFerryBuilding, FERRY_BUILDING } from './ferryBuilding.js';
export { createCityHall, CITY_HALL } from './cityHall.js';
export { createPalaceOfFineArts, PALACE_OF_FINE_ARTS } from './palaceOfFineArts.js';
export { createChinatownGate, CHINATOWN_GATE } from './chinatownGate.js';
export { createCableCar, CABLE_CAR } from './cableCar.js';
export { createPier39, PIER_39 } from './pier39.js';
export { createWharfSign, WHARF_SIGN } from './wharfSign.js';
export { createGhirardelliSign, GHIRARDELLI_SIGN } from './ghirardelliSign.js';
export { createSaintsPeterPaulChurch, SAINTS_PETER_PAUL } from './saintsPeterPaulChurch.js';
export { createSutroTower, SUTRO_TOWER } from './sutroTower.js';
export { createBalclutha, BALCLUTHA } from './balclutha.js';
export { createSeaLionDock, animateSeaLions, SEA_LION_DOCK } from './seaLionDock.js';

/**
 * Footprint (width along X, depth along Z) and height in metres, measured from the
 * generated geometry (bounding box), plus placement notes.
 * `bounds` = [minX, minY, minZ, maxX, maxY, maxZ] in the group's local space.
 */
export const LANDMARK_INFO = Object.freeze({
  goldenGateBridge: {
    factory: 'createGoldenGateBridge', width: 53, depth: 1120, height: 146,
    bounds: [-26.5, -4, -560, 26.5, 146, 560], inWater: true, drawCalls: 7,
    notes: 'Deck along Z, road surface y = 42 from z = -560..560 (6 lanes, curbs at x = ±9.6, deck edge ±13.5). '
      + 'Towers at z = ±320 (top 145), anchorages around z = ±504, abutments at the ends. -Z = SF/south, +Z = Marin. '
      + 'userData.deck = { y, zMin, zMax, roadHalfWidth, halfWidth }; userData.deckColliders = barriers ON the deck '
      + '(each has y = 42 as its base). Colliders are only the water-level piers/legs/anchorages.',
  },
  bayBridge: {
    factory: 'createBayBridge', width: 53, depth: 1700, height: 152,
    bounds: [-26.5, -4, -850, 26.5, 152, 850], inWater: true, drawCalls: 8,
    notes: 'Western span: two suspension bridges sharing the centre anchorage at z = 0. Upper road deck y = 55 '
      + '(lower deck y = 46.7), towers at z = ±212 and ±636, end anchorages at |z| 821..850. '
      + 'The Bay Lights (suspender LED strands) + cable necklace lights are night materials.',
  },
  alcatraz: {
    factory: 'createAlcatraz', width: 330, depth: 135, height: 68,
    bounds: [-184, -14.8, -90, 184, 68, 90], inWater: true, drawCalls: 8,
    notes: 'Island long axis along X (terrain skirt drops to -15 m under water out to ±184 x ±90). Plateau ~36 m, '
      + 'cellhouse on top, lighthouse at +X end, dock + Building 64 face +Z. Optional rotating lighthouse beam '
      + '(additive cone, night only, 110 m long, inflates the bbox) — userData.beam; call animateAlcatraz(group, t).',
  },
  transamericaPyramid: {
    factory: 'createTransamericaPyramid', width: 47, depth: 47, height: 201,
    bounds: [-23.5, -0.4, -23.5, 23.5, 201, 23.5], drawCalls: 6,
    notes: 'Square 44 m base, apex 200 m (+ beacon). Wings on ±X (east/west). Front +Z.',
  },
  salesforceTower: {
    factory: 'createSalesforceTower', width: 52, depth: 52, height: 234,
    bounds: [-25.8, -0.5, -25.8, 25.8, 234, 26], drawCalls: 4,
    notes: 'Glass to 200 m, open lattice crown 200–230 m with LED core (night). Lobby canopy on +Z.',
  },
  coitTower: {
    factory: 'createCoitTower', width: 26, depth: 26, height: 64,
    bounds: [-13, 0, -13, 13, 64, 13], drawCalls: 2, notes: 'Entrance portal + steps on +Z.',
  },
  ferryBuilding: {
    factory: 'createFerryBuilding', width: 132, depth: 35, height: 81,
    bounds: [-66, 0, -17, 66, 81.2, 18], drawCalls: 6,
    notes: 'Long axis along X, Embarcadero facade +Z. Clock tower centred at (0, z = 5): clock faces at y = 55, '
      + 'dome to ~75 m, flag pole to 81 m.',
  },
  cityHall: {
    factory: 'createCityHall', width: 55, depth: 54, height: 78,
    bounds: [-27.4, 0, -27, 27.4, 78, 27], drawCalls: 4,
    notes: 'Main block 54 x 40 x 24 m, porticos + steps on +Z and -Z, dome centred at the origin.',
  },
  palaceOfFineArts: {
    factory: 'createPalaceOfFineArts', width: 54, depth: 54, height: 36.2,
    bounds: [-23.4, -0.4, -25.6, 23.4, 36.2, 17.4], drawCalls: 3,
    notes: 'Open rotunda centred at the origin (you can drive in between the 8 pier clusters); curved double '
      + 'colonnade behind it on -Z. Lagoon side = +Z. Colliders = piers + columns only.',
  },
  chinatownGate: {
    factory: 'createChinatownGate', width: 26.2, depth: 5.9, height: 13.7,
    bounds: [-13.1, 0, -2.5, 13.1, 13.7, 3.4], straddlesRoad: true, drawCalls: 6,
    notes: 'STRADDLES A ROAD running along ±Z: x ∈ [-7.5, 7.5] is clear up to 7.56 m (verified). Pillars and lions '
      + 'stand on the sidewalks (|x| 7.75..12). Lions on the +Z side. userData.roadClear = { xMin, xMax, height }.',
  },
  cableCar: {
    factory: 'createCableCar', width: 3.1, depth: 8.7, height: 3.32,
    bounds: [-1.5, 0, -4.3, 1.5, 3.3, 4.3], vehicle: true, drawCalls: 7,
    notes: 'Front (grip end) = +Z, wheel bottoms at y = 0, rail gauge 1.067 m (wheels at x = ±0.53). Instances share '
      + 'geometry + materials. userData.lights = [headlight/running-light material] (also in nightMaterials).',
  },
  pier39: {
    factory: 'createPier39', width: 40.4, depth: 20.7, height: 19.7,
    bounds: [-20.2, 0, -10.7, 20.2, 19.7, 10], drawCalls: 8,
    notes: 'Building along X at the back (z -10..1), gateway + PIER 39 sign in the middle facing +Z, flag poles '
      + 'front-left, carousel front-right (12.4, 5.4).',
  },
  wharfSign: {
    factory: 'createWharfSign', width: 7.7, depth: 1.4, height: 9.1,
    bounds: [-3.9, 0, -0.7, 3.9, 9.1, 0.7], drawCalls: 5,
    notes: 'Double-sided (faces ±Z). Only the post is a collider.',
  },
  ghirardelliSign: {
    factory: 'createGhirardelliSign', width: 49, depth: 2.7, height: 7.5,
    bounds: [-24.5, 0, -2.4, 24.5, 7.5, 0.3], drawCalls: 3,
    notes: 'Origin = bottom centre of the frame (place on a roof). Letters face +Z, frame/struts behind (-Z).',
  },
  saintsPeterPaulChurch: {
    factory: 'createSaintsPeterPaulChurch', width: 30, depth: 50, height: 59.6,
    bounds: [-15, 0, -25.4, 15, 59.6, 24.9], drawCalls: 6,
    notes: 'Facade + steps on +Z (facade plane z = 21.5), spires at x = ±11.5 (crosses to 59.6 m), apse on -Z.',
  },
  sutroTower: {
    factory: 'createSutroTower', width: 69, depth: 61, height: 304,
    bounds: [-34.5, -0.5, -21.8, 34.5, 304, 39.1], drawCalls: 3,
    notes: 'Origin at the base centre (centroid of the 3 feet); leg 0 points to +Z, legs 60 m apart. '
      + 'Masts to 298 m, antenna tips 304 m.',
  },
  balclutha: {
    factory: 'createBalclutha', width: 25, depth: 89, height: 46.8,
    bounds: [-12.6, -6.4, -35.7, 12.6, 46.8, 53.5], inWater: true, drawCalls: 6,
    notes: 'Waterline y = 0 (keel at -6.2). Hull ~71 m centred on the origin (z -35.7..36), bow +Z; bowsprit and '
      + 'jib-boom reach z = 53.5. Yards span ±12.6 m in X.',
  },
  seaLionDock: {
    factory: 'createSeaLionDock', width: 12.2, depth: 5.7, height: 1.2,
    bounds: [-6.1, -0.6, -2.9, 6.1, 1.2, 2.9], inWater: true, drawCalls: 4,
    notes: 'Deck at y = 0.3 on the water. Call animateSeaLions(group, timeSeconds) each frame (bob + breathing + '
      + 'head raises; updates 2 instanced meshes).',
  },
});
