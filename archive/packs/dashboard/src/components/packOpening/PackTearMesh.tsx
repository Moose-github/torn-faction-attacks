import React from "react";
import {
  Application,
  Assets,
  Container,
  Graphics,
  Mesh,
  MeshGeometry,
  Sprite,
  Texture,
} from "pixi.js";
import energyCachePackFront from "../../assets/packs/energy-cache-pack-front.png";
import energyCachePackOpenBody from "../../assets/packs/energy-cache-pack-open-body.png";

const PIXI_PACK_WIDTH = 1122;
const PIXI_PACK_HEIGHT = 1402;
const PIXI_STRIP_COLUMNS = 56;
const PIXI_STRIP_ROWS = 10;

type PackTearMeshProps = {
  progress: number;
};

type PixiPackScene = {
  app: Application;
  sealedPack: Sprite;
  openBody: Sprite;
  lowerBody: Sprite;
  lowerBodyMask: Graphics;
  attachedTop: Mesh<MeshGeometry>;
  attachedGeometry: MeshGeometry;
  pulledTop: Mesh<MeshGeometry>;
  pulledGeometry: MeshGeometry;
  pulledPositions: Float32Array;
  pulledUvs: Float32Array;
  attachedPositions: Float32Array;
  attachedUvs: Float32Array;
};

type GridGeometry = {
  geometry: MeshGeometry;
  positions: Float32Array;
  uvs: Float32Array;
};

export function PackTearMesh({ progress }: PackTearMeshProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const sceneRef = React.useRef<PixiPackScene | null>(null);
  const progressRef = React.useRef(progress);

  React.useEffect(() => {
    progressRef.current = progress;
    updatePixiPackScene(sceneRef.current, progress);
  }, [progress]);

  React.useEffect(() => {
    let isCancelled = false;
    const host = hostRef.current;
    if (!host) {
      return;
    }

    void createPixiPackScene().then((scene) => {
      if (isCancelled) {
        scene.app.destroy(true, true);
        return;
      }

      sceneRef.current = scene;
      host.appendChild(scene.app.canvas);
      updatePixiPackScene(scene, progressRef.current);
    });

    return () => {
      isCancelled = true;
      const scene = sceneRef.current;
      sceneRef.current = null;
      scene?.app.destroy(true, true);
    };
  }, []);

  return <div ref={hostRef} className="siege-pack-pixi" aria-hidden="true" />;
}

async function createPixiPackScene(): Promise<PixiPackScene> {
  const app = new Application();
  await app.init({
    width: PIXI_PACK_WIDTH,
    height: PIXI_PACK_HEIGHT,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: "webgl",
  });

  const [frontTexture, openBodyTexture] = await Promise.all([
    Assets.load<Texture>(energyCachePackFront),
    Assets.load<Texture>(energyCachePackOpenBody),
  ]);

  const root = new Container();
  const sealedPack = createPackSprite(frontTexture);
  const openBody = createPackSprite(openBodyTexture);
  const lowerBody = createPackSprite(frontTexture);
  const lowerBodyMask = new Graphics();
  const attachedGeometry = createAttachedTopGeometry().geometry;
  const attachedTop = new Mesh({ texture: frontTexture, geometry: attachedGeometry });
  const pulledGrid = createGridGeometry(PIXI_STRIP_COLUMNS, PIXI_STRIP_ROWS);
  const pulledTop = new Mesh({ texture: frontTexture, geometry: pulledGrid.geometry });

  lowerBody.mask = lowerBodyMask;
  root.addChild(sealedPack, openBody, lowerBody, attachedTop, pulledTop, lowerBodyMask);
  app.stage.addChild(root);
  openBody.alpha = 0;

  return {
    app,
    sealedPack,
    openBody,
    lowerBody,
    lowerBodyMask,
    attachedTop,
    attachedGeometry,
    pulledTop,
    pulledGeometry: pulledGrid.geometry,
    pulledPositions: pulledGrid.positions,
    pulledUvs: pulledGrid.uvs,
    attachedPositions: attachedGeometry.positions,
    attachedUvs: attachedGeometry.uvs,
  };
}

function createPackSprite(texture: Texture) {
  const sprite = new Sprite(texture);
  sprite.width = PIXI_PACK_WIDTH;
  sprite.height = PIXI_PACK_HEIGHT;
  return sprite;
}

function createAttachedTopGeometry(): GridGeometry {
  const positions = new Float32Array(8);
  const uvs = new Float32Array(8);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const geometry = new MeshGeometry({ positions, uvs, indices });
  return { geometry, positions, uvs };
}

function createGridGeometry(columns: number, rows: number): GridGeometry {
  const vertexCount = (columns + 1) * (rows + 1);
  const positions = new Float32Array(vertexCount * 2);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(columns * rows * 6);
  let index = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * (columns + 1) + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + columns + 1;
      const bottomRight = bottomLeft + 1;

      indices[index] = topLeft;
      indices[index + 1] = topRight;
      indices[index + 2] = bottomRight;
      indices[index + 3] = topLeft;
      indices[index + 4] = bottomRight;
      indices[index + 5] = bottomLeft;
      index += 6;
    }
  }

  const geometry = new MeshGeometry({ positions, uvs, indices });
  return { geometry, positions, uvs };
}

function updatePixiPackScene(scene: PixiPackScene | null, rawProgress: number) {
  if (!scene) {
    return;
  }

  const progress = clamp(rawProgress, 0, 1);
  const width = PIXI_PACK_WIDTH;
  const height = PIXI_PACK_HEIGHT;
  const seamY = height * 0.158;
  const seamHeight = height * 0.029;
  const tearLineY = seamY + seamHeight * 0.3;
  const tearStart = width * 0.15;
  const tearEnd = width * 0.84;
  const tearX = tearStart + (tearEnd - tearStart) * progress;
  const hasTear = progress > 0.001;
  const tornFlapBottomY = tearLineY - (hasTear ? 10 + progress * 14 : 0);

  scene.sealedPack.alpha = hasTear ? 0 : 1;
  scene.openBody.alpha = hasTear ? Math.min(1, progress * 1.35) : 0;
  scene.lowerBody.visible = hasTear;
  scene.attachedTop.visible = hasTear && tearX < width - 1;
  scene.pulledTop.visible = hasTear;

  scene.lowerBodyMask.clear();
  scene.lowerBodyMask.rect(0, tearLineY, width, height).fill(0xffffff);
  scene.lowerBody.alpha = 1 - progress * 0.1;

  updateAttachedTopGeometry(scene, tearX, tearLineY, width, height);
  updatePulledTopGeometry(scene, progress, tearX, tornFlapBottomY, width, height);
}

function updateAttachedTopGeometry(
  scene: PixiPackScene,
  tearX: number,
  attachedHeight: number,
  width: number,
  height: number,
) {
  const positions = scene.attachedPositions;
  const uvs = scene.attachedUvs;
  positions.set([tearX, 0, width, 0, width, attachedHeight, tearX, attachedHeight]);
  uvs.set([tearX / width, 0, 1, 0, 1, attachedHeight / height, tearX / width, attachedHeight / height]);
  scene.attachedGeometry.positions = positions;
  scene.attachedGeometry.uvs = uvs;
}

function updatePulledTopGeometry(
  scene: PixiPackScene,
  progress: number,
  tearX: number,
  topHeight: number,
  width: number,
  height: number,
) {
  const visibleWidth = Math.max(1, tearX);
  const positions = scene.pulledPositions;
  const uvs = scene.pulledUvs;
  let offset = 0;

  for (let row = 0; row <= PIXI_STRIP_ROWS; row += 1) {
    const verticalRatio = row / PIXI_STRIP_ROWS;
    for (let column = 0; column <= PIXI_STRIP_COLUMNS; column += 1) {
      const horizontalRatio = column / PIXI_STRIP_COLUMNS;
      const sourceX = visibleWidth * horizontalRatio;
      const sourceY = topHeight * verticalRatio;
      const release = Math.pow(1 - horizontalRatio, 0.72);
      const looseEdge = 1 - verticalRatio;
      const hingeWeight = Math.pow(looseEdge, 0.38);
      const topLift = 0.36 + looseEdge * 0.82;
      const seamLift = Math.pow(1 - horizontalRatio, 1.12) * verticalRatio * 0.22 * hingeWeight;
      const peelInfluence = progress * (release * topLift + seamLift);
      const leadingLift = Math.pow(1 - horizontalRatio, 0.54);
      const trailingLift = Math.pow(horizontalRatio, 1.7);
      const arc = Math.sin(horizontalRatio * Math.PI);
      const rowCurl = Math.sin(verticalRatio * Math.PI);
      const foldCurl = Math.sin((1 - verticalRatio) * Math.PI) * release * progress;
      const flutter = Math.sin(column * 0.58 + row * 1.17 + progress * 5.4) * 2.8 * peelInfluence * hingeWeight;
      const destX = sourceX
        + peelInfluence * hingeWeight * (width * 0.022 * leadingLift + width * 0.008 * trailingLift)
        + foldCurl * (width * 0.035 + arc * 12);
      const destY = sourceY
        - peelInfluence * hingeWeight * (112 * leadingLift + 54 * arc + 16 * trailingLift)
        - seamLift * progress * 44
        + rowCurl * progress * release * hingeWeight * (20 * arc - 10 * leadingLift)
        + flutter;

      positions[offset] = destX;
      positions[offset + 1] = destY;
      uvs[offset] = sourceX / width;
      uvs[offset + 1] = sourceY / height;
      offset += 2;
    }
  }

  scene.pulledTop.alpha = Math.min(1, progress * 10);
  scene.pulledGeometry.positions = positions;
  scene.pulledGeometry.uvs = uvs;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
