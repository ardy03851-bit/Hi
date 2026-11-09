import * as THREE from 'three';

const BASEPLATE_SIZE = 28;
const BASEPLATE_THICKNESS = 0.4;
const CUBE_SIZE = 1.25;
const MOVE_SPEED = 7;
const JUMP_SPEED = 8;
const GRAVITY = 20;
const CAMERA_OFFSET = new THREE.Vector3(7, 8, 11);

const world = document.querySelector('#world');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe9f5);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
camera.position.set(CAMERA_OFFSET.x, CAMERA_OFFSET.y, CAMERA_OFFSET.z);
camera.lookAt(0, 0.6, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
world.appendChild(renderer.domElement);

const baseplate = new THREE.Mesh(
  new THREE.BoxGeometry(BASEPLATE_SIZE, BASEPLATE_THICKNESS, BASEPLATE_SIZE),
  new THREE.MeshStandardMaterial({
    color: 0xd9dfe8,
    roughness: 0.95,
    metalness: 0,
  }),
);
baseplate.position.y = -BASEPLATE_THICKNESS / 2;
baseplate.receiveShadow = true;
scene.add(baseplate);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE),
  new THREE.MeshStandardMaterial({
    color: 0x3f7bed,
    roughness: 0.55,
    metalness: 0,
  }),
);
cube.position.y = CUBE_SIZE / 2;
cube.castShadow = true;
scene.add(cube);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8b9bb2, 1.5));

const sunlight = new THREE.DirectionalLight(0xffffff, 1.8);
sunlight.position.set(-8, 16, 10);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(1024, 1024);
sunlight.shadow.camera.left = -26;
sunlight.shadow.camera.right = 26;
sunlight.shadow.camera.top = 26;
sunlight.shadow.camera.bottom = -26;
sunlight.shadow.camera.near = 1;
sunlight.shadow.camera.far = 60;
sunlight.shadow.normalBias = 0.02;
scene.add(sunlight);

const joystick = document.querySelector('#joystick');
const joystickKnob = document.querySelector('#joystick-knob');
const jumpButton = document.querySelector('#jump-button');

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

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
resize();

const desiredCameraPosition = new THREE.Vector3();
const desiredCameraTarget = new THREE.Vector3();
const cameraTarget = new THREE.Vector3(0, 0.6, 0);
const movementLimit = BASEPLATE_SIZE / 2 - CUBE_SIZE / 2 - 0.5;

const cameraHorizontalDistance = Math.hypot(CAMERA_OFFSET.x, CAMERA_OFFSET.z);
const forwardX = -CAMERA_OFFSET.x / cameraHorizontalDistance;
const forwardZ = -CAMERA_OFFSET.z / cameraHorizontalDistance;
const rightX = CAMERA_OFFSET.z / cameraHorizontalDistance;
const rightZ = -CAMERA_OFFSET.x / cameraHorizontalDistance;

let verticalVelocity = 0;
let grounded = true;
let previousTime = performance.now();

function update(delta) {
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

  cube.position.x += worldMoveX * MOVE_SPEED * delta;
  cube.position.z += worldMoveZ * MOVE_SPEED * delta;
  cube.position.x = THREE.MathUtils.clamp(
    cube.position.x,
    -movementLimit,
    movementLimit,
  );
  cube.position.z = THREE.MathUtils.clamp(
    cube.position.z,
    -movementLimit,
    movementLimit,
  );

  const leanEase = 1 - Math.exp(-12 * delta);
  cube.rotation.x = THREE.MathUtils.lerp(
    cube.rotation.x,
    worldMoveZ * 0.08,
    leanEase,
  );
  cube.rotation.z = THREE.MathUtils.lerp(
    cube.rotation.z,
    -worldMoveX * 0.08,
    leanEase,
  );

  if (jumpRequested && grounded) {
    verticalVelocity = JUMP_SPEED;
    grounded = false;
  }
  jumpRequested = false;

  if (!grounded) {
    verticalVelocity -= GRAVITY * delta;
    cube.position.y += verticalVelocity * delta;

    if (cube.position.y <= CUBE_SIZE / 2) {
      cube.position.y = CUBE_SIZE / 2;
      verticalVelocity = 0;
      grounded = true;
    }
  }

  const followEase = 1 - Math.exp(-8 * delta);
  desiredCameraPosition.set(
    cube.position.x + CAMERA_OFFSET.x,
    CAMERA_OFFSET.y,
    cube.position.z + CAMERA_OFFSET.z,
  );
  desiredCameraTarget.set(cube.position.x, 0.6, cube.position.z);
  camera.position.lerp(desiredCameraPosition, followEase);
  cameraTarget.lerp(desiredCameraTarget, followEase);
  camera.lookAt(cameraTarget);
}

renderer.setAnimationLoop((time) => {
  const delta = Math.min(Math.max((time - previousTime) / 1000, 0), 1 / 30);
  previousTime = time;

  update(delta);
  renderer.render(scene, camera);
});
