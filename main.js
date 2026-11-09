import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GROUND_SIZE = 32;
const GROUND_SEGMENTS = 48;
const GROUND_HALF = GROUND_SIZE / 2;
const GROUND_STEP = GROUND_SIZE / GROUND_SEGMENTS;
const CUBE_SIZE = 1.45;
const MOVE_SPEED = 5.6;
const ACCELERATION = 7;
const FRICTION = 4.5;
const JUMP_SPEED = 7.4;
const GRAVITY = 21;
const CAMERA_OFFSET = new THREE.Vector3(8, 8.5, 12);
const MOVEMENT_LIMIT = GROUND_HALF - CUBE_SIZE / 2 - 0.7;

const MAX_SCARS = 120;
const MAX_DEBRIS = 72;
const MAX_DUST = 240;
const MAX_RINGS = 8;
const MAX_FIREFLIES = 30;

const world = document.querySelector('#world');
const joystick = document.querySelector('#joystick');
const joystickKnob = document.querySelector('#joystick-knob');
const jumpButton = document.querySelector('#jump-button');

function createRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function randomBetween(random, min, max) {
  return min + (max - min) * random();
}

const environmentRandom = createRandom(20261109);
const UP_AXIS = new THREE.Vector3(0, 1, 0);

// Renderer, scene, camera, and cozy sunset sky.
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xf7d5ab, 25, 72);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 220);
camera.position.copy(CAMERA_OFFSET);
camera.lookAt(0, 0.8, 0);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setClearColor(0xf7d5ab, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;
world.appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.52, 0.88);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// Warm, soft lighting with one crisp sun shadow.
scene.add(new THREE.HemisphereLight(0xffedcf, 0x607a63, 1.65));

const sunlight = new THREE.DirectionalLight(0xffd19a, 2.5);
sunlight.position.set(-10, 18, 12);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
sunlight.shadow.camera.left = -24;
sunlight.shadow.camera.right = 24;
sunlight.shadow.camera.top = 24;
sunlight.shadow.camera.bottom = -24;
sunlight.shadow.camera.near = 1;
sunlight.shadow.camera.far = 65;
sunlight.shadow.bias = -0.0004;
sunlight.shadow.normalBias = 0.025;
sunlight.shadow.radius = 3;
scene.add(sunlight);

const coolFill = new THREE.DirectionalLight(0xb8d5ff, 0.55);
coolFill.position.set(12, 9, -12);
scene.add(coolFill);

// AI-generated surface textures.
const textureLoader = new THREE.TextureLoader();
const maximumAnisotropy = renderer.capabilities.getMaxAnisotropy();
const textureUrl = (name) => `${import.meta.env.BASE_URL}textures/${name}`;

function loadTexture(name, options = {}) {
  const {
    repeat = [1, 1],
    offset = [0, 0],
    mirrored = false,
  } = options;

  const texture = textureLoader.load(textureUrl(name));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = mirrored ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = mirrored ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.offset.set(offset[0], offset[1]);
  texture.anisotropy = maximumAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

const grassTexture = loadTexture('cozy-grass.jpg', {
  repeat: [1.25, 1.25],
  mirrored: true,
});
const soilTexture = loadTexture('exposed-soil.jpg', {
  repeat: [1.1, 1.1],
  mirrored: true,
});
const barkTexture = loadTexture('tree-bark.jpg', {
  repeat: [1.7, 1],
  mirrored: true,
});
const leafTexture = loadTexture('leaf-canopy.jpg', {
  repeat: [1.15, 1.15],
  mirrored: true,
});
const stoneTexture = loadTexture('heavy-stone.jpg', {
  repeat: [1.12, 1.12],
  offset: [-0.06, -0.06],
});
const dustTexture = loadTexture('dust-puff.jpg');
const skyTexture = loadTexture('cozy-sky.jpg', {
  repeat: [1, 0.68],
});
scene.background = new THREE.Color(0xf7d5ab);

// A screen-aligned textured quad keeps the AI sky visible from every camera position.
const skyQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({
    map: skyTexture,
    depthTest: false,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  }),
);
skyQuad.position.z = -1;
skyQuad.renderOrder = -1000;
skyQuad.frustumCulled = false;
camera.add(skyQuad);
scene.add(camera);

// Deformable low-poly ground. Damage is stored on a grid and applied to the mesh.
const damageGrid = new Float32Array((GROUND_SEGMENTS + 1) * (GROUND_SEGMENTS + 1));

function damageIndex(ix, iz) {
  return iz * (GROUND_SEGMENTS + 1) + ix;
}

function baseGroundHeight(x, z) {
  return (
    0.055 * Math.sin(x * 0.58) * Math.cos(z * 0.46) +
    0.035 * Math.sin((x + z) * 0.9) +
    0.02 * Math.cos(x * 1.2 - z * 0.7)
  );
}

function gridDamageAt(x, z) {
  const gridX = THREE.MathUtils.clamp(
    (x + GROUND_HALF) / GROUND_STEP,
    0,
    GROUND_SEGMENTS,
  );
  const gridZ = THREE.MathUtils.clamp(
    (z + GROUND_HALF) / GROUND_STEP,
    0,
    GROUND_SEGMENTS,
  );
  const ix = Math.floor(gridX);
  const iz = Math.floor(gridZ);
  const nextIx = Math.min(ix + 1, GROUND_SEGMENTS);
  const nextIz = Math.min(iz + 1, GROUND_SEGMENTS);
  const fx = gridX - ix;
  const fz = gridZ - iz;

  const bottom =
    damageGrid[damageIndex(ix, iz)] * (1 - fx) +
    damageGrid[damageIndex(nextIx, iz)] * fx;
  const top =
    damageGrid[damageIndex(ix, nextIz)] * (1 - fx) +
    damageGrid[damageIndex(nextIx, nextIz)] * fx;
  return bottom * (1 - fz) + top * fz;
}

function getGroundHeight(x, z) {
  return baseGroundHeight(x, z) - gridDamageAt(x, z);
}

const groundGeometry = new THREE.PlaneGeometry(
  GROUND_SIZE,
  GROUND_SIZE,
  GROUND_SEGMENTS,
  GROUND_SEGMENTS,
).toNonIndexed();
groundGeometry.rotateX(-Math.PI / 2);

const groundPosition = groundGeometry.getAttribute('position');
const groundBaseHeights = new Float32Array(groundPosition.count);

for (let i = 0; i < groundPosition.count; i += 1) {
  const x = groundPosition.getX(i);
  const z = groundPosition.getZ(i);
  groundBaseHeights[i] = baseGroundHeight(x, z);
  groundPosition.setY(i, groundBaseHeights[i]);
}
groundGeometry.computeVertexNormals();

const ground = new THREE.Mesh(
  groundGeometry,
  new THREE.MeshStandardMaterial({
    map: grassTexture,
    roughness: 0.96,
    metalness: 0,
    flatShading: true,
    side: THREE.DoubleSide,
  }),
);
ground.receiveShadow = true;
ground.frustumCulled = false;
scene.add(ground);

const groundBase = new THREE.Mesh(
  new THREE.BoxGeometry(GROUND_SIZE, 1.4, GROUND_SIZE),
  new THREE.MeshStandardMaterial({
    map: soilTexture,
    color: 0xbd8b61,
    bumpMap: soilTexture,
    bumpScale: 0.035,
    roughness: 1,
    flatShading: true,
  }),
);
groundBase.position.y = -1.2;
groundBase.castShadow = true;
groundBase.receiveShadow = true;
scene.add(groundBase);

function updateGroundHeights() {
  for (let i = 0; i < groundPosition.count; i += 1) {
    const x = groundPosition.getX(i);
    const z = groundPosition.getZ(i);
    groundPosition.setY(i, groundBaseHeights[i] - gridDamageAt(x, z));
  }
  groundPosition.needsUpdate = true;
  groundGeometry.computeVertexNormals();
  groundGeometry.attributes.normal.needsUpdate = true;
}

function stampGround(x, z, radius, strength) {
  const minIx = Math.max(0, Math.floor((x - radius + GROUND_HALF) / GROUND_STEP));
  const maxIx = Math.min(
    GROUND_SEGMENTS,
    Math.ceil((x + radius + GROUND_HALF) / GROUND_STEP),
  );
  const minIz = Math.max(0, Math.floor((z - radius + GROUND_HALF) / GROUND_STEP));
  const maxIz = Math.min(
    GROUND_SEGMENTS,
    Math.ceil((z + radius + GROUND_HALF) / GROUND_STEP),
  );

  for (let iz = minIz; iz <= maxIz; iz += 1) {
    for (let ix = minIx; ix <= maxIx; ix += 1) {
      const nodeX = -GROUND_HALF + ix * GROUND_STEP;
      const nodeZ = -GROUND_HALF + iz * GROUND_STEP;
      const distance = Math.hypot(nodeX - x, nodeZ - z);
      if (distance >= radius) continue;

      const falloff = 1 - distance / radius;
      const index = damageIndex(ix, iz);
      damageGrid[index] = Math.min(
        damageGrid[index] + strength * falloff * falloff,
        0.18,
      );
    }
  }

  updateGroundHeights();
}

// Persistent exposed-soil scars left behind by the cube.
const scarGeometry = new THREE.CircleGeometry(0.62, 7);
scarGeometry.rotateX(-Math.PI / 2);
const scars = new THREE.InstancedMesh(
  scarGeometry,
  new THREE.MeshStandardMaterial({
    map: soilTexture,
    color: 0xe0b98b,
    roughness: 1,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
  }),
  MAX_SCARS,
);
scars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scars.frustumCulled = false;
scene.add(scars);

const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
const white = new THREE.Color(0xffffff);
for (let i = 0; i < MAX_SCARS; i += 1) {
  scars.setMatrixAt(i, hiddenMatrix);
  scars.setColorAt(i, white);
}
scars.instanceMatrix.needsUpdate = true;

const scarMatrix = new THREE.Matrix4();
const scarPosition = new THREE.Vector3();
const scarQuaternion = new THREE.Quaternion();
const scarScale = new THREE.Vector3();
const scarTint = new THREE.Color();
let scarCursor = 0;

function addScar(x, z, strength = 1) {
  const width = (0.38 + Math.random() * 0.26) * strength;
  const depth = width * randomBetween(environmentRandom, 0.78, 1.22);
  scarPosition.set(x, getGroundHeight(x, z) + 0.028, z);
  scarQuaternion.setFromAxisAngle(UP_AXIS, Math.random() * Math.PI * 2);
  scarScale.set(width, 1, depth);
  scarMatrix.compose(scarPosition, scarQuaternion, scarScale);
  scars.setMatrixAt(scarCursor, scarMatrix);

  const shade = randomBetween(environmentRandom, 0.78, 1.02);
  scarTint.setRGB(shade, shade * 0.94, shade * 0.84);
  scars.setColorAt(scarCursor, scarTint);
  scars.instanceMatrix.needsUpdate = true;
  if (scars.instanceColor) scars.instanceColor.needsUpdate = true;
  scarCursor = (scarCursor + 1) % MAX_SCARS;
}

// Heavy beveled stone cube and a soft procedural contact shadow.
function createContactShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 6, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(45, 32, 22, 0.48)');
  gradient.addColorStop(0.5, 'rgba(45, 32, 22, 0.2)');
  gradient.addColorStop(1, 'rgba(45, 32, 22, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const cubeRig = new THREE.Group();
cubeRig.position.set(0, getGroundHeight(0, 0) + CUBE_SIZE / 2, 0);
scene.add(cubeRig);

const cube = new THREE.Mesh(
  new RoundedBoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3, 0.16),
  new THREE.MeshStandardMaterial({
    map: stoneTexture,
    color: 0xe8eee9,
    bumpMap: stoneTexture,
    bumpScale: 0.045,
    roughness: 0.84,
    metalness: 0.02,
  }),
);
cube.castShadow = true;
cube.receiveShadow = true;
cubeRig.add(cube);

const cubeGlow = new THREE.PointLight(0xffc888, 0.45, 6, 2);
cubeGlow.position.set(0, 0.7, 0);
cubeRig.add(cubeGlow);

const contactShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(3.4, 3.4),
  new THREE.MeshBasicMaterial({
    map: createContactShadowTexture(),
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  }),
);
contactShadow.rotation.x = -Math.PI / 2;
contactShadow.renderOrder = 3;
contactShadow.frustumCulled = false;
scene.add(contactShadow);

// Cozy storybook tree with bark, foliage, branches, and glowing fruit.
const barkMaterial = new THREE.MeshStandardMaterial({
  map: barkTexture,
  roughness: 0.95,
  flatShading: true,
});
const leafMaterial = new THREE.MeshStandardMaterial({
  map: leafTexture,
  color: 0xf0f5d8,
  roughness: 0.9,
  flatShading: true,
});
const fruitMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color().setRGB(1.8, 1.05, 0.42),
  toneMapped: false,
});

function createTree(x, z, scale, random) {
  const group = new THREE.Group();
  group.position.set(x, getGroundHeight(x, z), z);
  group.scale.setScalar(scale);
  group.rotation.y = random() * Math.PI * 2;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.44, 2.6, 7, 1),
    barkMaterial,
  );
  trunk.position.y = 1.3;
  trunk.rotation.z = -0.045;
  group.add(trunk);

  const branchGeometry = new THREE.CylinderGeometry(0.08, 0.15, 1.35, 6);
  const leftBranch = new THREE.Mesh(branchGeometry, barkMaterial);
  leftBranch.position.set(-0.58, 2.45, 0.05);
  leftBranch.rotation.z = Math.PI / 3;
  group.add(leftBranch);

  const rightBranch = new THREE.Mesh(branchGeometry, barkMaterial);
  rightBranch.position.set(0.58, 2.65, -0.08);
  rightBranch.rotation.z = -Math.PI / 3.4;
  group.add(rightBranch);

  const canopyPieces = [
    [1.5, 3.15, 0, 0, 1],
    [1.15, 3.9, -0.65, 0.22, 1],
    [1.08, 3.78, 0.72, -0.28, 1],
    [0.92, 4.55, 0.05, 0.08, 0],
  ];

  for (const [radius, y, offsetX, offsetZ, detail] of canopyPieces) {
    const canopy = new THREE.Mesh(
      new THREE.IcosahedronGeometry(radius, detail),
      leafMaterial,
    );
    canopy.position.set(offsetX, y, offsetZ);
    canopy.rotation.set(random() * 0.4, random() * Math.PI, random() * 0.4);
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    group.add(canopy);
  }

  for (let i = 0; i < 8; i += 1) {
    const fruit = new THREE.Mesh(
      new THREE.IcosahedronGeometry(randomBetween(random, 0.075, 0.12), 0),
      fruitMaterial,
    );
    const angle = random() * Math.PI * 2;
    const fruitRadius = randomBetween(random, 0.75, 1.65);
    fruit.position.set(
      Math.cos(angle) * fruitRadius,
      randomBetween(random, 3.0, 4.55),
      Math.sin(angle) * fruitRadius,
    );
    group.add(fruit);
  }

  group.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  scene.add(group);
  return group;
}

createTree(-7.5, -5.8, 1.12, environmentRandom);
createTree(8.2, -7.4, 0.72, environmentRandom);

// Small mushrooms and rocks near the hero tree.
const mushroomStemMaterial = new THREE.MeshStandardMaterial({
  color: 0xfff0cf,
  roughness: 0.85,
  flatShading: true,
});
const mushroomCapMaterial = new THREE.MeshStandardMaterial({
  color: 0xc96a48,
  roughness: 0.78,
  flatShading: true,
});
const mushroomSpotMaterial = new THREE.MeshBasicMaterial({ color: 0xfff3d8 });

function createMushroom(x, z, scale, random) {
  const group = new THREE.Group();
  group.position.set(x, getGroundHeight(x, z), z);
  group.scale.setScalar(scale);
  group.rotation.y = random() * Math.PI * 2;

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.085, 0.28, 6),
    mushroomStemMaterial,
  );
  stem.position.y = 0.14;
  group.add(stem);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    mushroomCapMaterial,
  );
  cap.position.y = 0.28;
  cap.scale.y = 0.62;
  group.add(cap);

  for (let i = 0; i < 3; i += 1) {
    const spot = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.026, 0),
      mushroomSpotMaterial,
    );
    const angle = random() * Math.PI * 2;
    const radius = randomBetween(random, 0.04, 0.13);
    spot.position.set(
      Math.cos(angle) * radius,
      0.35 + randomBetween(random, 0.01, 0.06),
      Math.sin(angle) * radius,
    );
    group.add(spot);
  }

  group.traverse((object) => {
    if (object.isMesh) object.castShadow = true;
  });
  scene.add(group);
}

for (let i = 0; i < 8; i += 1) {
  const angle = (i / 8) * Math.PI * 2 + environmentRandom() * 0.45;
  const radius = randomBetween(environmentRandom, 1.7, 3.4);
  createMushroom(
    -7.5 + Math.cos(angle) * radius,
    -5.8 + Math.sin(angle) * radius,
    randomBetween(environmentRandom, 0.75, 1.3),
    environmentRandom,
  );
}

const rockMaterial = new THREE.MeshStandardMaterial({
  map: stoneTexture,
  color: 0xb9c1b7,
  roughness: 0.95,
  flatShading: true,
});
for (let i = 0; i < 9; i += 1) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), rockMaterial);
  let x = randomBetween(environmentRandom, -11, 11);
  let z = randomBetween(environmentRandom, -11, 9);
  if (Math.hypot(x, z) < 4.5) {
    const angle = Math.atan2(z, x);
    x = Math.cos(angle) * 5.2;
    z = Math.sin(angle) * 5.2;
  }
  rock.position.set(x, getGroundHeight(x, z) + 0.19, z);
  rock.scale.set(
    randomBetween(environmentRandom, 0.6, 1.35),
    randomBetween(environmentRandom, 0.55, 1.05),
    randomBetween(environmentRandom, 0.6, 1.35),
  );
  rock.rotation.set(
    environmentRandom() * Math.PI,
    environmentRandom() * Math.PI,
    environmentRandom() * Math.PI,
  );
  rock.castShadow = true;
  rock.receiveShadow = true;
  scene.add(rock);
}

// Soft low-poly clouds drifting in the warm sky.
const cloudMaterial = new THREE.MeshBasicMaterial({
  color: 0xfff2da,
  transparent: true,
  opacity: 0.88,
  fog: false,
});
const cloudGroups = [];

function createCloud(x, y, z, scale, phase) {
  const group = new THREE.Group();
  for (let i = 0; i < 4; i += 1) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), cloudMaterial);
    puff.position.set(
      randomBetween(environmentRandom, -1.4, 1.4),
      randomBetween(environmentRandom, -0.25, 0.35),
      randomBetween(environmentRandom, -0.6, 0.6),
    );
    puff.scale.set(
      randomBetween(environmentRandom, 0.8, 1.6),
      randomBetween(environmentRandom, 0.45, 0.85),
      randomBetween(environmentRandom, 0.7, 1.2),
    );
    group.add(puff);
  }
  group.position.set(x, y, z);
  group.scale.setScalar(scale);
  scene.add(group);
  cloudGroups.push({ group, baseX: x, phase });
}

createCloud(-10, 11, -18, 1.35, 0.3);
createCloud(5, 12.5, -24, 1.05, 1.8);
createCloud(14, 10, -16, 0.85, 3.1);

// Glowing fireflies around the hero tree.
const fireflies = new THREE.InstancedMesh(
  new THREE.IcosahedronGeometry(0.055, 0),
  new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(2.2, 1.55, 0.65),
    toneMapped: false,
  }),
  MAX_FIREFLIES,
);
fireflies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
fireflies.frustumCulled = false;
scene.add(fireflies);

const fireflyData = [];
for (let i = 0; i < MAX_FIREFLIES; i += 1) {
  const angle = environmentRandom() * Math.PI * 2;
  const radius = randomBetween(environmentRandom, 1.2, 5.2);
  fireflyData.push({
    x: -7.5 + Math.cos(angle) * radius,
    z: -5.8 + Math.sin(angle) * radius,
    y: randomBetween(environmentRandom, 1.1, 4.4),
    phase: environmentRandom() * Math.PI * 2,
    speed: randomBetween(environmentRandom, 0.6, 1.5),
    scale: randomBetween(environmentRandom, 0.65, 1.45),
  });
}

const fireflyMatrix = new THREE.Matrix4();
const fireflyPosition = new THREE.Vector3();
const fireflyQuaternion = new THREE.Quaternion();
const fireflyScale = new THREE.Vector3();

function updateFireflies(seconds) {
  for (let i = 0; i < MAX_FIREFLIES; i += 1) {
    const data = fireflyData[i];
    const drift = seconds * data.speed + data.phase;
    fireflyPosition.set(
      data.x + Math.sin(drift * 0.7) * 0.45,
      data.y + Math.sin(drift) * 0.34,
      data.z + Math.cos(drift * 0.55) * 0.45,
    );
    const pulse = (0.7 + Math.sin(drift * 2.1) * 0.3) * data.scale;
    fireflyScale.setScalar(pulse);
    fireflyMatrix.compose(fireflyPosition, fireflyQuaternion, fireflyScale);
    fireflies.setMatrixAt(i, fireflyMatrix);
  }
  fireflies.instanceMatrix.needsUpdate = true;
}

// Premium dust particles using the AI-generated puff texture.
const dustGeometry = new THREE.BufferGeometry();
const dustPositions = new Float32Array(MAX_DUST * 3);
const dustColors = new Float32Array(MAX_DUST * 3);
const dustSizes = new Float32Array(MAX_DUST);
const dustAlphas = new Float32Array(MAX_DUST);
const dustStates = [];
let dustCursor = 0;

for (let i = 0; i < MAX_DUST; i += 1) {
  dustPositions[i * 3 + 1] = -100;
  dustStates.push({
    life: 0,
    maxLife: 1,
    vx: 0,
    vy: 0,
    vz: 0,
    size: 0,
  });
}

dustGeometry.setAttribute(
  'position',
  new THREE.BufferAttribute(dustPositions, 3).setUsage(THREE.DynamicDrawUsage),
);
dustGeometry.setAttribute(
  'aColor',
  new THREE.BufferAttribute(dustColors, 3).setUsage(THREE.DynamicDrawUsage),
);
dustGeometry.setAttribute(
  'aSize',
  new THREE.BufferAttribute(dustSizes, 1).setUsage(THREE.DynamicDrawUsage),
);
dustGeometry.setAttribute(
  'aAlpha',
  new THREE.BufferAttribute(dustAlphas, 1).setUsage(THREE.DynamicDrawUsage),
);

const dustMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uMap: { value: dustTexture },
  },
  vertexShader: `
    attribute vec3 aColor;
    attribute float aSize;
    attribute float aAlpha;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vColor = aColor;
      vAlpha = aAlpha;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * (320.0 / max(-mvPosition.z, 0.1));
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform sampler2D uMap;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec4 texel = texture2D(uMap, gl_PointCoord);
      float intensity = max(texel.r, max(texel.g, texel.b));
      float alpha = vAlpha * intensity;
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(vColor * intensity, alpha);
    }
  `,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  depthTest: true,
  toneMapped: false,
});
const dustPoints = new THREE.Points(dustGeometry, dustMaterial);
dustPoints.frustumCulled = false;
scene.add(dustPoints);

function spawnDust(x, y, z, count, strength) {
  for (let n = 0; n < count; n += 1) {
    const i = dustCursor;
    dustCursor = (dustCursor + 1) % MAX_DUST;
    const state = dustStates[i];
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.45 + Math.random() * 1.15) * strength;
    const life = 0.55 + Math.random() * 0.7;
    const offset = i * 3;

    dustPositions[offset] = x + (Math.random() - 0.5) * 0.55;
    dustPositions[offset + 1] = y + Math.random() * 0.18;
    dustPositions[offset + 2] = z + (Math.random() - 0.5) * 0.55;
    dustColors[offset] = 1.0;
    dustColors[offset + 1] = 0.82 + Math.random() * 0.15;
    dustColors[offset + 2] = 0.58 + Math.random() * 0.2;

    state.life = life;
    state.maxLife = life;
    state.vx = Math.cos(angle) * speed;
    state.vy = (0.55 + Math.random() * 0.9) * strength;
    state.vz = Math.sin(angle) * speed;
    state.size = (0.35 + Math.random() * 0.5) * strength;
    dustSizes[i] = state.size;
    dustAlphas[i] = 0.42;
  }

  dustGeometry.attributes.position.needsUpdate = true;
  dustGeometry.attributes.aColor.needsUpdate = true;
  dustGeometry.attributes.aSize.needsUpdate = true;
  dustGeometry.attributes.aAlpha.needsUpdate = true;
}

function updateDust(delta) {
  let changed = false;
  for (let i = 0; i < MAX_DUST; i += 1) {
    const state = dustStates[i];
    if (state.life <= 0) continue;

    changed = true;
    state.life -= delta;
    const offset = i * 3;
    if (state.life <= 0) {
      dustAlphas[i] = 0;
      dustSizes[i] = 0;
      continue;
    }

    dustPositions[offset] += state.vx * delta;
    dustPositions[offset + 1] += state.vy * delta;
    dustPositions[offset + 2] += state.vz * delta;
    state.vx *= 1 - 1.8 * delta;
    state.vz *= 1 - 1.8 * delta;
    state.vy += 0.35 * delta;

    const remaining = state.life / state.maxLife;
    dustAlphas[i] = Math.min(1, remaining * 1.8) * 0.42;
    dustSizes[i] = state.size * (0.8 + (1 - remaining) * 0.75);
  }

  if (changed) {
    dustGeometry.attributes.position.needsUpdate = true;
    dustGeometry.attributes.aSize.needsUpdate = true;
    dustGeometry.attributes.aAlpha.needsUpdate = true;
  }
}

// Chunky low-poly debris thrown up by heavy impacts.
const debris = new THREE.InstancedMesh(
  new THREE.TetrahedronGeometry(0.13, 0),
  new THREE.MeshStandardMaterial({
    map: soilTexture,
    color: 0xa97449,
    roughness: 1,
    flatShading: true,
  }),
  MAX_DEBRIS,
);
debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
debris.frustumCulled = false;
scene.add(debris);

const debrisStates = [];
for (let i = 0; i < MAX_DEBRIS; i += 1) {
  debris.setMatrixAt(i, hiddenMatrix);
  debrisStates.push({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    rotation: new THREE.Euler(),
    spin: new THREE.Vector3(),
    life: 0,
    maxLife: 1,
    scale: 0,
  });
}
debris.instanceMatrix.needsUpdate = true;

const debrisMatrix = new THREE.Matrix4();
const debrisQuaternion = new THREE.Quaternion();
const debrisScale = new THREE.Vector3();
let debrisCursor = 0;

function spawnDebris(x, y, z, count, strength) {
  for (let n = 0; n < count; n += 1) {
    const i = debrisCursor;
    debrisCursor = (debrisCursor + 1) % MAX_DEBRIS;
    const state = debrisStates[i];
    const angle = Math.random() * Math.PI * 2;
    const speed = (1.2 + Math.random() * 2.4) * strength;
    const life = 0.75 + Math.random() * 0.65;

    state.position.set(
      x + (Math.random() - 0.5) * 0.45,
      y + Math.random() * 0.12,
      z + (Math.random() - 0.5) * 0.45,
    );
    state.velocity.set(
      Math.cos(angle) * speed,
      (2.2 + Math.random() * 2.1) * strength,
      Math.sin(angle) * speed,
    );
    state.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );
    state.spin.set(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
    );
    state.life = life;
    state.maxLife = life;
    state.scale = (0.55 + Math.random() * 0.85) * Math.min(strength, 1.7);
  }
}

function updateDebris(delta) {
  let changed = false;
  for (let i = 0; i < MAX_DEBRIS; i += 1) {
    const state = debrisStates[i];
    if (state.life <= 0) continue;

    changed = true;
    state.life -= delta;
    if (state.life <= 0) {
      debris.setMatrixAt(i, hiddenMatrix);
      continue;
    }

    state.velocity.y -= 12 * delta;
    state.position.addScaledVector(state.velocity, delta);
    const floor = getGroundHeight(state.position.x, state.position.z) + 0.08;
    if (state.position.y < floor) {
      state.position.y = floor;
      state.velocity.y *= -0.28;
      state.velocity.x *= 0.7;
      state.velocity.z *= 0.7;
    }
    state.rotation.x += state.spin.x * delta;
    state.rotation.y += state.spin.y * delta;
    state.rotation.z += state.spin.z * delta;

    debrisQuaternion.setFromEuler(state.rotation);
    const remaining = state.life / state.maxLife;
    debrisScale.setScalar(state.scale * (0.35 + remaining * 0.65));
    debrisMatrix.compose(state.position, debrisQuaternion, debrisScale);
    debris.setMatrixAt(i, debrisMatrix);
  }
  if (changed) debris.instanceMatrix.needsUpdate = true;
}

// Expanding warm impact rings.
const rings = [];
for (let i = 0; i < MAX_RINGS; i += 1) {
  const geometry = new THREE.RingGeometry(0.5, 0.64, 40);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(1.9, 1.15, 0.48),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  mesh.visible = false;
  mesh.renderOrder = 4;
  scene.add(mesh);
  rings.push({ mesh, life: 0, maxLife: 0.65, strength: 1 });
}
let ringCursor = 0;

function spawnRipple(x, z, strength) {
  const ring = rings[ringCursor];
  ringCursor = (ringCursor + 1) % MAX_RINGS;
  ring.life = 0.65;
  ring.maxLife = 0.65;
  ring.strength = strength;
  ring.mesh.position.set(x, getGroundHeight(x, z) + 0.045, z);
  ring.mesh.scale.setScalar(0.35);
  ring.mesh.material.opacity = 0.55;
  ring.mesh.visible = true;
}

function updateRings(delta) {
  for (const ring of rings) {
    if (ring.life <= 0) continue;
    ring.life -= delta;
    if (ring.life <= 0) {
      ring.mesh.visible = false;
      ring.mesh.material.opacity = 0;
      continue;
    }
    const progress = 1 - ring.life / ring.maxLife;
    const scale = (0.35 + progress * 2.7) * Math.min(ring.strength, 1.8);
    ring.mesh.scale.set(scale, 1, scale);
    ring.mesh.material.opacity = (1 - progress) * 0.5;
  }
}

function triggerImpact(x, z, strength) {
  stampGround(x, z, 0.62 + strength * 0.32, 0.012 * strength);
  addScar(x, z, 0.7 + strength * 0.14);
  const groundY = getGroundHeight(x, z);
  spawnDust(x, groundY + 0.08, z, Math.round(4 + strength * 7), strength * 0.75);
  spawnDebris(x, groundY + 0.1, z, Math.round(2 + strength * 5), strength);
  spawnRipple(x, z, strength);
  shake = Math.max(shake, 0.035 + strength * 0.085);
  squash = Math.max(squash, Math.min(1, 0.22 + strength * 0.48));
}

// iPad touch controls.
const movement = { x: 0, y: 0 };
let movePointerId = null;
let jumpPointerId = null;
let jumpRequested = false;

function setKnobOffset(x, y) {
  joystickKnob.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
}

function updateJoystick(event) {
  const bounds = joystick.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const radius = bounds.width * 0.3;
  let x = event.clientX - centerX;
  let y = event.clientY - centerY;
  const distance = Math.hypot(x, y);

  if (distance > radius) {
    x = (x / distance) * radius;
    y = (y / distance) * radius;
  }

  setKnobOffset(x, y);
  movement.x = x / radius;
  movement.y = y / radius;
}

function resetJoystick(event) {
  if (movePointerId !== event.pointerId) return;
  movePointerId = null;
  movement.x = 0;
  movement.y = 0;
  setKnobOffset(0, 0);
  joystick.classList.remove('is-active');
}

joystick.addEventListener('pointerdown', (event) => {
  if (movePointerId !== null) return;
  event.preventDefault();
  movePointerId = event.pointerId;
  joystick.setPointerCapture(event.pointerId);
  joystick.classList.add('is-active');
  updateJoystick(event);
});

joystick.addEventListener('pointermove', (event) => {
  if (event.pointerId !== movePointerId) return;
  event.preventDefault();
  updateJoystick(event);
});

for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  joystick.addEventListener(eventName, resetJoystick);
}
joystick.addEventListener('contextmenu', (event) => event.preventDefault());

function clearJumpButton(event) {
  if (jumpPointerId !== event.pointerId) return;
  jumpPointerId = null;
  jumpButton.classList.remove('is-active');
}

jumpButton.addEventListener('pointerdown', (event) => {
  if (jumpPointerId !== null) return;
  event.preventDefault();
  jumpPointerId = event.pointerId;
  jumpRequested = true;
  jumpButton.setPointerCapture(event.pointerId);
  jumpButton.classList.add('is-active');
});

for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  jumpButton.addEventListener(eventName, clearJumpButton);
}
jumpButton.addEventListener('contextmenu', (event) => event.preventDefault());

// Responsive rendering.
function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  const skyHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  skyQuad.scale.set(skyHeight * camera.aspect, skyHeight, 1);
}

window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
resize();

// Simulation state.
const cameraHorizontalDistance = Math.hypot(CAMERA_OFFSET.x, CAMERA_OFFSET.z);
const forwardX = -CAMERA_OFFSET.x / cameraHorizontalDistance;
const forwardZ = -CAMERA_OFFSET.z / cameraHorizontalDistance;
const rightX = CAMERA_OFFSET.z / cameraHorizontalDistance;
const rightZ = -CAMERA_OFFSET.x / cameraHorizontalDistance;

const desiredCameraPosition = new THREE.Vector3();
const desiredCameraTarget = new THREE.Vector3();
const cameraTarget = new THREE.Vector3(0, 0.85, 0);
const velocity = new THREE.Vector2();

let verticalVelocity = 0;
let grounded = true;
let damageDistance = 0;
let shake = 0;
let squash = 0;
let previousTime = performance.now();

function update(delta, seconds) {
  let inputX = movement.x;
  let inputY = movement.y;
  const inputLengthSquared = inputX * inputX + inputY * inputY;
  if (inputLengthSquared > 1) {
    const scale = 1 / Math.sqrt(inputLengthSquared);
    inputX *= scale;
    inputY *= scale;
  }

  const forwardInput = -inputY;
  const rightInput = inputX;
  const worldMoveX = rightX * rightInput + forwardX * forwardInput;
  const worldMoveZ = rightZ * rightInput + forwardZ * forwardInput;
  const hasInput = Math.abs(inputX) + Math.abs(inputY) > 0.01;
  const response = hasInput ? ACCELERATION : FRICTION;
  const velocityEase = 1 - Math.exp(-response * delta);
  velocity.x += (worldMoveX * MOVE_SPEED - velocity.x) * velocityEase;
  velocity.y += (worldMoveZ * MOVE_SPEED - velocity.y) * velocityEase;

  const currentSpeed = velocity.length();
  if (currentSpeed > MOVE_SPEED) velocity.multiplyScalar(MOVE_SPEED / currentSpeed);

  cubeRig.position.x += velocity.x * delta;
  cubeRig.position.z += velocity.y * delta;
  const clampedX = THREE.MathUtils.clamp(
    cubeRig.position.x,
    -MOVEMENT_LIMIT,
    MOVEMENT_LIMIT,
  );
  const clampedZ = THREE.MathUtils.clamp(
    cubeRig.position.z,
    -MOVEMENT_LIMIT,
    MOVEMENT_LIMIT,
  );
  if (clampedX !== cubeRig.position.x) velocity.x = 0;
  if (clampedZ !== cubeRig.position.z) velocity.y = 0;
  cubeRig.position.x = clampedX;
  cubeRig.position.z = clampedZ;

  if (currentSpeed > 0.18) {
    const targetYaw = Math.atan2(velocity.x, velocity.y);
    const difference = Math.atan2(
      Math.sin(targetYaw - cubeRig.rotation.y),
      Math.cos(targetYaw - cubeRig.rotation.y),
    );
    cubeRig.rotation.y += difference * (1 - Math.exp(-3.5 * delta));
  }

  const leanEase = 1 - Math.exp(-9 * delta);
  cube.rotation.x = THREE.MathUtils.lerp(
    cube.rotation.x,
    velocity.y * 0.022,
    leanEase,
  );
  cube.rotation.z = THREE.MathUtils.lerp(
    cube.rotation.z,
    -velocity.x * 0.022,
    leanEase,
  );

  const groundCenterY =
    getGroundHeight(cubeRig.position.x, cubeRig.position.z) + CUBE_SIZE / 2;

  if (jumpRequested && grounded) {
    verticalVelocity = JUMP_SPEED;
    grounded = false;
    cubeRig.position.y = groundCenterY + 0.02;
    squash = Math.max(squash, 0.18);
    shake = Math.max(shake, 0.055);
    const dustY = getGroundHeight(cubeRig.position.x, cubeRig.position.z);
    spawnDust(cubeRig.position.x, dustY + 0.08, cubeRig.position.z, 7, 0.55);
    spawnRipple(cubeRig.position.x, cubeRig.position.z, 0.6);
  }
  jumpRequested = false;

  if (!grounded) {
    verticalVelocity -= GRAVITY * delta;
    cubeRig.position.y += verticalVelocity * delta;
    if (cubeRig.position.y <= groundCenterY) {
      cubeRig.position.y = groundCenterY;
      verticalVelocity = 0;
      grounded = true;
      triggerImpact(cubeRig.position.x, cubeRig.position.z, 1.55);
    }
  } else {
    cubeRig.position.y = groundCenterY;
  }

  if (grounded && currentSpeed > 0.28) {
    damageDistance += currentSpeed * delta;
    if (damageDistance >= 0.68) {
      damageDistance = 0;
      triggerImpact(
        cubeRig.position.x,
        cubeRig.position.z,
        0.42 + Math.min(currentSpeed / MOVE_SPEED, 1) * 0.35,
      );
    }
  } else {
    damageDistance = 0;
  }

  squash = Math.max(0, squash - delta * 3.1);
  const verticalScale = 1 - squash * 0.18;
  const horizontalScale = 1 + squash * 0.1;
  cube.scale.set(horizontalScale, verticalScale, horizontalScale);
  cube.position.y = -(CUBE_SIZE * (1 - verticalScale)) / 2;

  const groundY = getGroundHeight(cubeRig.position.x, cubeRig.position.z);
  const heightAboveGround = Math.max(
    0,
    cubeRig.position.y - (groundY + CUBE_SIZE / 2),
  );
  contactShadow.position.set(cubeRig.position.x, groundY + 0.035, cubeRig.position.z);
  const shadowScale = 1 + heightAboveGround * 0.14;
  contactShadow.scale.set(shadowScale, shadowScale, 1);
  contactShadow.material.opacity = 0.72 / (1 + heightAboveGround * 0.5);

  const followEase = 1 - Math.exp(-7 * delta);
  desiredCameraPosition.set(
    cubeRig.position.x + CAMERA_OFFSET.x,
    CAMERA_OFFSET.y,
    cubeRig.position.z + CAMERA_OFFSET.z,
  );
  desiredCameraTarget.set(cubeRig.position.x, 0.85, cubeRig.position.z);
  camera.position.lerp(desiredCameraPosition, followEase);
  cameraTarget.lerp(desiredCameraTarget, followEase);

  shake = Math.max(0, shake - delta * 2.1);
  const shakePower = shake * shake * 0.32;
  camera.position.x += Math.sin(seconds * 47) * shakePower;
  camera.position.y += Math.sin(seconds * 61) * shakePower * 0.55;
  camera.position.z += Math.cos(seconds * 39) * shakePower;
  camera.lookAt(cameraTarget);

  for (const cloud of cloudGroups) {
    cloud.group.position.x =
      cloud.baseX + Math.sin(seconds * 0.06 + cloud.phase) * 2.4;
  }

  updateFireflies(seconds);
  updateDust(delta);
  updateDebris(delta);
  updateRings(delta);
}

renderer.setAnimationLoop((time) => {
  const delta = Math.min(Math.max((time - previousTime) / 1000, 0), 1 / 30);
  previousTime = time;
  const seconds = time * 0.001;
  update(delta, seconds);
  composer.render();
});
