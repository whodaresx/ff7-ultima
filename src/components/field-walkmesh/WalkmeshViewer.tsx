import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import { MapControls as MapControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { MOUSE } from "three";
import { Walkmesh, calculateWalkmeshBounds, Gateway } from "@/ff7/walkmesh";
import { FieldModel } from "@/types";
import WalkmeshMesh from "./WalkmeshMesh";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";


interface WalkmeshViewerProps {
  walkmesh: Walkmesh | null;
  gateways: Gateway[];
  fieldModels: FieldModel[];
  fieldName: string;
  fieldId: number;
  isLoading: boolean;
  onModelPositionChange?: (index: number, x: number, y: number, z: number, triangleId: number) => void;
}

const CAMERA_HEIGHT = 10000;
const SCALE = 1;

interface SceneControlsProps {
  mapCenter: { x: number; y: number; z: number };
  mapWidth: number;
  mapHeight: number;
  controlsRef: React.RefObject<MapControlsImpl>;
  onResetRef: React.MutableRefObject<(() => void) | null>;
}

function SceneControls({ mapCenter, mapWidth, mapHeight, controlsRef, onResetRef }: SceneControlsProps) {
  const { camera, gl } = useThree();
  const initializedRef = useRef(false);
  const lastMapCenterRef = useRef({ x: 0, y: 0, z: 0 });

  const setupCamera = useCallback(() => {
    const orthoCam = camera as THREE.OrthographicCamera;
    
    const margin = 200;
    const containerAspect = gl.domElement.clientWidth / gl.domElement.clientHeight;
    const mapAspect = mapWidth / mapHeight || 1;

    let halfHeight = Math.max(mapHeight, 500) / 2 + margin;
    let halfWidth = Math.max(mapWidth, 500) / 2 + margin;

    if (containerAspect > mapAspect) {
      halfWidth = halfHeight * containerAspect;
    } else {
      halfHeight = halfWidth / containerAspect;
    }

    orthoCam.left = -halfWidth;
    orthoCam.right = halfWidth;
    orthoCam.top = halfHeight;
    orthoCam.bottom = -halfHeight;
    orthoCam.near = -100000;
    orthoCam.far = 100000;
    orthoCam.position.set(mapCenter.x, CAMERA_HEIGHT, mapCenter.z);
    orthoCam.lookAt(mapCenter.x, 0, mapCenter.z);
    orthoCam.zoom = 1;
    orthoCam.updateProjectionMatrix();

    if (controlsRef.current) {
      controlsRef.current.target.set(mapCenter.x, 0, mapCenter.z);
      controlsRef.current.update();
    }
  }, [camera, gl, mapCenter, mapWidth, mapHeight, controlsRef]);

  const handleResize = useCallback(() => {
    const orthoCam = camera as THREE.OrthographicCamera;
    
    const margin = 200;
    const containerAspect = gl.domElement.clientWidth / gl.domElement.clientHeight;
    const mapAspect = mapWidth / mapHeight || 1;

    let halfHeight = Math.max(mapHeight, 500) / 2 + margin;
    let halfWidth = Math.max(mapWidth, 500) / 2 + margin;

    if (containerAspect > mapAspect) {
      halfWidth = halfHeight * containerAspect;
    } else {
      halfHeight = halfWidth / containerAspect;
    }

    const currentZoom = orthoCam.zoom;
    orthoCam.left = -halfWidth;
    orthoCam.right = halfWidth;
    orthoCam.top = halfHeight;
    orthoCam.bottom = -halfHeight;
    orthoCam.zoom = currentZoom;
    orthoCam.updateProjectionMatrix();
  }, [camera, gl, mapWidth, mapHeight]);

  useEffect(() => {
    const centerChanged = 
      Math.abs(mapCenter.x - lastMapCenterRef.current.x) > 100 ||
      Math.abs(mapCenter.z - lastMapCenterRef.current.z) > 100;
    
    if (mapWidth > 0 && (!initializedRef.current || centerChanged)) {
      initializedRef.current = true;
      lastMapCenterRef.current = { ...mapCenter };
      setupCamera();
    }
  }, [mapWidth, mapCenter, setupCamera]);

  useEffect(() => {
    onResetRef.current = () => {
      setupCamera();
    };
  }, [setupCamera, onResetRef]);

  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  const handleCameraChange = useCallback(() => {
    const orthoCam = camera as THREE.OrthographicCamera;
    if (orthoCam.zoom < 0.1) {
      orthoCam.zoom = 0.1;
      orthoCam.updateProjectionMatrix();
    }
  }, [camera]);

  return (
    <MapControls
      ref={controlsRef}
      enableDamping={false}
      enableRotate={true}
      enablePan={true}
      enableZoom={true}
      screenSpacePanning={true}
      mouseButtons={{
        LEFT: MOUSE.PAN,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.ROTATE,
      }}
      onChange={handleCameraChange}
    />
  );
}

function WalkmeshViewer({
  walkmesh,
  gateways,
  fieldModels,
  fieldName,
  fieldId,
  isLoading,
  onModelPositionChange,
}: WalkmeshViewerProps) {
  const [wireframe, setWireframe] = useState(true);
  const [showModels, setShowModels] = useState(true);
  const [showGateways, setShowGateways] = useState(true);
  const [showTriangleIds, setShowTriangleIds] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const controlsRef = useRef<MapControlsImpl>(null);
  const resetFnRef = useRef<(() => void) | null>(null);

  const bounds = useMemo(() => {
    if (!walkmesh) return null;
    return calculateWalkmeshBounds(walkmesh);
  }, [walkmesh]);

  const mapDimensions = useMemo(() => {
    if (!bounds) return { width: 0, height: 0, center: { x: 0, y: 0, z: 0 } };

    const width = (bounds.maxX - bounds.minX) * SCALE;
    const height = (bounds.maxY - bounds.minY) * SCALE;

    return {
      width,
      height,
      center: {
        x: bounds.centerX * SCALE,
        y: bounds.centerZ * SCALE,
        z: -bounds.centerY * SCALE,
      },
    };
  }, [bounds]);

  useEffect(() => {
    if (mapDimensions.width > 0) {
      setLoaded(true);
    }
  }, [mapDimensions.width]);

  const handleReset = useCallback(() => {
    if (resetFnRef.current) {
      resetFnRef.current();
    }
  }, []);

  return (
    <div className="relative flex flex-col w-full h-full bg-zinc-900">
      <div className="absolute top-2 left-2 z-10 flex gap-2 items-center bg-zinc-800/90 px-3 py-2 rounded-md">
        <span className="text-xs text-zinc-300 font-medium">
          {fieldName || "Field Walkmesh"}
        </span>
        <div className="w-px h-4 bg-zinc-600" />
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Switch
            checked={wireframe}
            onCheckedChange={setWireframe}
            className="scale-75"
          />
          Wireframe
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Switch
            checked={showModels}
            onCheckedChange={setShowModels}
            className="scale-75"
          />
          Models
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Switch
            checked={showGateways}
            onCheckedChange={setShowGateways}
            className="scale-75"
          />
          Gateways
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Switch
            checked={showTriangleIds}
            onCheckedChange={setShowTriangleIds}
            className="scale-75"
          />
          IDs
        </label>
        <div className="w-px h-4 bg-zinc-600" />
        <Button size="xs" variant="outline" onClick={handleReset}>
          Reset
        </Button>
      </div>

      <div className="absolute bottom-2 left-2 z-10 text-xs text-zinc-500 bg-zinc-800/90 px-2 py-1 rounded">
        Drag models to reposition
      </div>

      <div className="relative flex-1">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <div className="text-lg text-muted-foreground">
              Waiting for field data...
            </div>
          </div>
        )}

        <Canvas
          style={{
            width: "100%",
            height: "100%",
            opacity: !isLoading && loaded ? 1 : 0,
          }}
          orthographic
          camera={{
            position: [mapDimensions.center.x, CAMERA_HEIGHT, mapDimensions.center.z],
            near: -100000,
            far: 100000,
            zoom: 1,
          }}
        >
          <color attach="background" args={["#111111"]} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[1000, 2000, 1000]} intensity={0.8} />
          <SceneControls
            mapCenter={mapDimensions.center}
            mapWidth={mapDimensions.width}
            mapHeight={mapDimensions.height}
            controlsRef={controlsRef}
            onResetRef={resetFnRef}
          />
          {walkmesh && (
            <WalkmeshMesh
              walkmesh={walkmesh}
              wireframe={wireframe}
              fieldModels={showModels ? fieldModels : []}
              gateways={showGateways ? gateways : []}
              showTriangleIds={showTriangleIds}
              onModelPositionChange={onModelPositionChange}
              controlsRef={controlsRef}
            />
          )}
        </Canvas>
      </div>
    </div>
  );
}

export default WalkmeshViewer;
