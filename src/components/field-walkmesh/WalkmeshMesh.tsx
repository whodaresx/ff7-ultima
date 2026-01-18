import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import * as THREE from "three";
import { ThreeEvent, useThree, useFrame } from "@react-three/fiber";
import { MapControls as MapControlsImpl } from "three-stdlib";
import { Walkmesh, WalkmeshTriangle, Gateway } from "@/ff7/walkmesh";
import { FieldModel } from "@/types";

// Sprite scaling constants for triangle ID labels
const BASE_SPRITE_SCALE = 80;
const MIN_SPRITE_SCALE = 15;
const MAX_SPRITE_SCALE = 100;

// Create a canvas texture for a triangle ID label
function createTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Draw text
  ctx.font = 'bold 32px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#b0d0ff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.strokeText(text, size / 2, size / 2);
  ctx.fillText(text, size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(40, 40, 1);

  return sprite;
}

interface TriangleIdLabelsProps {
  walkmesh: Walkmesh;
}

function TriangleIdLabels({ walkmesh }: TriangleIdLabelsProps) {
  const groupRef = useRef<THREE.Group>(null);
  const spritesRef = useRef<THREE.Sprite[]>([]);
  const { camera } = useThree();

  // Create sprites for all triangles
  const sprites = useMemo(() => {
    const result: { sprite: THREE.Sprite; position: [number, number, number] }[] = [];
    
    for (let i = 0; i < walkmesh.triangles.length; i++) {
      const triangle = walkmesh.triangles[i];
      const v = triangle.vertices;

      // Calculate centroid
      const cx = (v[0].x + v[1].x + v[2].x) / 3;
      const cy = (v[0].z + v[1].z + v[2].z) / 3;
      const cz = -(v[0].y + v[1].y + v[2].y) / 3;

      const sprite = createTextSprite(String(i));
      result.push({
        sprite,
        position: [cx, cy + 2, cz],
      });
    }

    spritesRef.current = result.map(r => r.sprite);
    return result;
  }, [walkmesh]);

  // Scale sprites inversely with zoom on each frame
  useFrame(() => {
    const orthoCam = camera as THREE.OrthographicCamera;
    const zoom = orthoCam.zoom || 1;
    const rawScale = BASE_SPRITE_SCALE / zoom;
    const spriteScale = Math.max(MIN_SPRITE_SCALE, Math.min(MAX_SPRITE_SCALE, rawScale));

    for (const sprite of spritesRef.current) {
      sprite.scale.set(spriteScale, spriteScale, 1);
    }
  });

  // Cleanup textures on unmount
  useEffect(() => {
    return () => {
      for (const sprite of spritesRef.current) {
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
    };
  }, []);

  return (
    <group ref={groupRef}>
      {sprites.map((item, index) => (
        <primitive
          key={index}
          object={item.sprite}
          position={item.position}
        />
      ))}
    </group>
  );
}

function pointInTriangle(px: number, py: number, v0x: number, v0y: number, v1x: number, v1y: number, v2x: number, v2y: number): boolean {
  const dX = px - v2x;
  const dY = py - v2y;
  const dX21 = v2x - v1x;
  const dY12 = v1y - v2y;
  const D = dY12 * (v0x - v2x) + dX21 * (v0y - v2y);
  const s = dY12 * dX + dX21 * dY;
  const t = (v2y - v0y) * dX + (v0x - v2x) * dY;
  if (D < 0) return s <= 0 && t <= 0 && s + t >= D;
  return s >= 0 && t >= 0 && s + t <= D;
}

function calculateZAtPoint(x: number, y: number, tri: WalkmeshTriangle): number {
  const v0 = tri.vertices[0];
  const v1 = tri.vertices[1];
  const v2 = tri.vertices[2];

  const denom = (v1.y - v2.y) * (v0.x - v2.x) + (v2.x - v1.x) * (v0.y - v2.y);
  if (Math.abs(denom) < 0.0001) {
    return (v0.z + v1.z + v2.z) / 3;
  }

  const w0 = ((v1.y - v2.y) * (x - v2.x) + (v2.x - v1.x) * (y - v2.y)) / denom;
  const w1 = ((v2.y - v0.y) * (x - v2.x) + (v0.x - v2.x) * (y - v2.y)) / denom;
  const w2 = 1 - w0 - w1;

  return w0 * v0.z + w1 * v1.z + w2 * v2.z;
}

interface TriangleInfo {
  triangleId: number;
  z: number;
}

function findTriangleAtPosition(walkmesh: Walkmesh, x: number, y: number): TriangleInfo {
  for (let i = 0; i < walkmesh.triangles.length; i++) {
    const tri = walkmesh.triangles[i];
    const v = tri.vertices;
    if (pointInTriangle(x, y, v[0].x, v[0].y, v[1].x, v[1].y, v[2].x, v[2].y)) {
      const z = calculateZAtPoint(x, y, tri);
      return { triangleId: i, z: Math.round(z) };
    }
  }
  return { triangleId: -1, z: 0 };
}

interface DraggableModelProps {
  model: FieldModel;
  index: number;
  walkmesh: Walkmesh;
  onPositionChange: (index: number, x: number, y: number, z: number, triangleId: number) => void;
  controlsRef: React.RefObject<MapControlsImpl>;
}

function DraggableModel({ model, index, walkmesh, onPositionChange, controlsRef }: DraggableModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [isHovered, setIsHovered] = useState(false);
  const { camera, gl } = useThree();
  
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const dragOffsetRef = useRef(new THREE.Vector3());
  const raycasterRef = useRef(new THREE.Raycaster());
  const lastUpdateTimeRef = useRef(0);
  const DEBOUNCE_MS = 50;

  const isPlayer = index === 0;
  const baseColor = isPlayer ? "#ffaa00" : "#00ff88";
  const hoverColor = isPlayer ? "#ffcc44" : "#44ffaa";
  const dragColor = "#ff6666";
  const defaultSize = isPlayer ? 40 : 25;
  const collisionRadius = model.collision_range > 0 ? model.collision_range : defaultSize;

  const currentColor = isDragging ? dragColor : isHovered ? hoverColor : baseColor;

  const getMousePosition = useCallback((clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
  }, [gl]);

  const sendPositionUpdate = useCallback(() => {
    if (!groupRef.current) return;
    const newX = Math.round(groupRef.current.position.x);
    const newY = Math.round(-groupRef.current.position.z);
    const { triangleId, z } = findTriangleAtPosition(walkmesh, newX, newY);
    onPositionChange(index, newX, newY, z, triangleId);
  }, [index, walkmesh, onPositionChange]);

  const updatePosition = useCallback((clientX: number, clientY: number) => {
    if (!groupRef.current) return;
    
    const mouse = getMousePosition(clientX, clientY);
    raycasterRef.current.setFromCamera(mouse, camera);

    const intersection = new THREE.Vector3();
    if (raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, intersection)) {
      const newPos = intersection.add(dragOffsetRef.current);
      groupRef.current.position.x = newPos.x;
      groupRef.current.position.z = newPos.z;
    }
  }, [camera, getMousePosition]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    updatePosition(e.clientX, e.clientY);

    const now = Date.now();
    if (now - lastUpdateTimeRef.current >= DEBOUNCE_MS) {
      lastUpdateTimeRef.current = now;
      sendPositionUpdate();
    }
  }, [updatePosition, sendPositionUpdate]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    
    isDraggingRef.current = false;
    setIsDragging(false);
    gl.domElement.style.cursor = "auto";
    
    if (controlsRef.current) {
      controlsRef.current.enabled = true;
    }

    sendPositionUpdate();
  }, [gl, sendPositionUpdate, controlsRef]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    
    isDraggingRef.current = true;
    setIsDragging(true);
    gl.domElement.style.cursor = "grabbing";
    
    if (controlsRef.current) {
      controlsRef.current.enabled = false;
    }

    const intersectPoint = e.point;
    dragPlaneRef.current.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      intersectPoint
    );
    
    if (groupRef.current) {
      dragOffsetRef.current.copy(groupRef.current.position).sub(intersectPoint);
    }
  };

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setIsHovered(true);
    if (!isDraggingRef.current) {
      gl.domElement.style.cursor = "grab";
    }
  };

  const handlePointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setIsHovered(false);
    if (!isDraggingRef.current) {
      gl.domElement.style.cursor = "auto";
    }
  };

  const capsuleHeight = collisionRadius * 2;
  const capsuleYOffset = collisionRadius * 2;

  return (
    <group
      ref={groupRef}
      position={[model.x, model.z, -model.y]}
      onPointerDown={handlePointerDown}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <mesh position={[0, capsuleYOffset, 0]}>
        <capsuleGeometry args={[collisionRadius, capsuleHeight, 2, 16]} />
        <meshStandardMaterial color={currentColor} transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, capsuleYOffset, 0]}>
        <capsuleGeometry args={[collisionRadius, capsuleHeight, 2, 16]} />
        <meshBasicMaterial color={currentColor} wireframe />
      </mesh>
    </group>
  );
}

interface WalkmeshMeshProps {
  walkmesh: Walkmesh;
  wireframe: boolean;
  fieldModels: FieldModel[];
  gateways: Gateway[];
  showTriangleIds: boolean;
  onModelPositionChange?: (index: number, x: number, y: number, z: number, triangleId: number) => void;
  controlsRef: React.RefObject<MapControlsImpl>;
}

function WalkmeshMesh({ walkmesh, wireframe, fieldModels, gateways, showTriangleIds, onModelPositionChange, controlsRef }: WalkmeshMeshProps) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];

    let vertexIndex = 0;
    for (const triangle of walkmesh.triangles) {
      for (const vertex of triangle.vertices) {
        positions.push(vertex.x, vertex.z, -vertex.y);
        // #1E293B (dark slate)
        colors.push(0.118, 0.161, 0.231);
      }

      indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
      vertexIndex += 3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    return geo;
  }, [walkmesh]);

  const edgeGeometry = useMemo(() => {
    const positions: number[] = [];

    for (const triangle of walkmesh.triangles) {
      const v = triangle.vertices;
      
      positions.push(v[0].x, v[0].z, -v[0].y);
      positions.push(v[1].x, v[1].z, -v[1].y);

      positions.push(v[1].x, v[1].z, -v[1].y);
      positions.push(v[2].x, v[2].z, -v[2].y);

      positions.push(v[2].x, v[2].z, -v[2].y);
      positions.push(v[0].x, v[0].z, -v[0].y);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );

    return geo;
  }, [walkmesh]);

  const blockedEdgeGeometry = useMemo(() => {
    const positions: number[] = [];

    for (const triangle of walkmesh.triangles) {
      const v = triangle.vertices;
      const access = triangle.access;

      if (access[0] === 0xffff) {
        positions.push(v[0].x, v[0].z, -v[0].y);
        positions.push(v[1].x, v[1].z, -v[1].y);
      }

      if (access[1] === 0xffff) {
        positions.push(v[1].x, v[1].z, -v[1].y);
        positions.push(v[2].x, v[2].z, -v[2].y);
      }

      if (access[2] === 0xffff) {
        positions.push(v[2].x, v[2].z, -v[2].y);
        positions.push(v[0].x, v[0].z, -v[0].y);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );

    return geo;
  }, [walkmesh]);

  const gatewayQuadsGeometry = useMemo(() => {
    const positions: number[] = [];
    const indices: number[] = [];
    const QUAD_SIZE = 20;

    let vertexIndex = 0;
    for (const gateway of gateways) {
      for (const vertex of [gateway.vertex1, gateway.vertex2]) {
        const x = vertex.x;
        const y = vertex.z;
        const z = -vertex.y;

        positions.push(x - QUAD_SIZE, y + 5, z - QUAD_SIZE);
        positions.push(x + QUAD_SIZE, y + 5, z - QUAD_SIZE);
        positions.push(x + QUAD_SIZE, y + 5, z + QUAD_SIZE);
        positions.push(x - QUAD_SIZE, y + 5, z + QUAD_SIZE);

        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
        vertexIndex += 4;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    return geo;
  }, [gateways]);

  const gatewayLinesGeometry = useMemo(() => {
    const positions: number[] = [];

    for (const gateway of gateways) {
      const v1 = gateway.vertex1;
      const v2 = gateway.vertex2;

      positions.push(v1.x, v1.z + 5, -v1.y);
      positions.push(v2.x, v2.z + 5, -v2.y);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

    return geo;
  }, [gateways]);

  const handlePositionChange = useCallback((index: number, x: number, y: number, z: number, triangleId: number) => {
    if (onModelPositionChange) {
      onModelPositionChange(index, x, y, z, triangleId);
    }
  }, [onModelPositionChange]);

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          side={THREE.DoubleSide}
          transparent
          opacity={wireframe ? 0.3 : 0.8}
        />
      </mesh>

      {wireframe && (
        <>
          <lineSegments geometry={edgeGeometry}>
            <lineBasicMaterial color="#3E4C5E" opacity={0.4} transparent />
          </lineSegments>

          <lineSegments geometry={blockedEdgeGeometry}>
            <lineBasicMaterial color="#eeeeff" opacity={0.5} transparent linewidth={2} />
          </lineSegments>
        </>
      )}

      {gateways.length > 0 && (
        <>
          <mesh geometry={gatewayQuadsGeometry}>
            <meshStandardMaterial
              color="#ff3333"
              side={THREE.DoubleSide}
              transparent
              opacity={0.8}
            />
          </mesh>
          <lineSegments geometry={gatewayLinesGeometry}>
            <lineBasicMaterial color="#ff3333" opacity={0.9} transparent />
          </lineSegments>
        </>
      )}

      {fieldModels.map((model, index) => {
        if (
          Math.abs(model.x) > 50000 ||
          Math.abs(model.y) > 50000 ||
          Math.abs(model.z) > 50000
        ) {
          return null;
        }

        return (
          <DraggableModel
            key={index}
            model={model}
            index={index}
            walkmesh={walkmesh}
            onPositionChange={handlePositionChange}
            controlsRef={controlsRef}
          />
        );
      })}

      {showTriangleIds && <TriangleIdLabels walkmesh={walkmesh} />}
    </group>
  );
}

export default WalkmeshMesh;
