import { ThemeProvider } from "@/components/theme-provider";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";
import { useEffect, useState, useCallback } from "react";
import WalkmeshViewer from "./WalkmeshViewer";
import { Walkmesh, parseWalkmesh, Gateway, parseGateways } from "@/ff7/walkmesh";
import { FieldModel } from "@/types";

export interface FieldWalkmeshData {
  walkmeshBuffer: number[];
  gatewaysBuffer: number[];
  fieldModels: FieldModel[];
  fieldName: string;
  fieldId: number;
}

export interface ModelPositionUpdate {
  modelIndex: number;
  x: number;
  y: number;
  z: number;
  triangleId: number;
}

function App() {
  const [walkmesh, setWalkmesh] = useState<Walkmesh | null>(null);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [fieldModels, setFieldModels] = useState<FieldModel[]>([]);
  const [fieldName, setFieldName] = useState<string>("");
  const [fieldId, setFieldId] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const window = getCurrentWebviewWindow();
    if (window) {
      const unlisten = window.listen("field-walkmesh-data", (event) => {
        const data = event?.payload as FieldWalkmeshData;
        if (data) {
          if (data.walkmeshBuffer && data.walkmeshBuffer.length > 0) {
            const parsed = parseWalkmesh(data.walkmeshBuffer);
            setWalkmesh(parsed);
            setIsLoading(false);
          }
          if (data.gatewaysBuffer && data.gatewaysBuffer.length > 0) {
            const parsedGateways = parseGateways(data.gatewaysBuffer);
            setGateways(parsedGateways);
          }
          if (data.fieldModels) {
            setFieldModels(data.fieldModels);
          }
          if (data.fieldName) {
            setFieldName(data.fieldName);
          }
          if (data.fieldId) {
            setFieldId(data.fieldId);
          }
        }
      });

      return () => {
        unlisten.then((fn) => fn());
      };
    }
  }, []);

  const handleModelPositionChange = useCallback((index: number, x: number, y: number, z: number, triangleId: number) => {
    emit("field-model-position-update", {
      modelIndex: index,
      x,
      y,
      z,
      triangleId,
    } as ModelPositionUpdate);
  }, []);

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <WalkmeshViewer
        walkmesh={walkmesh}
        gateways={gateways}
        fieldModels={fieldModels}
        fieldName={fieldName}
        fieldId={fieldId}
        isLoading={isLoading}
        onModelPositionChange={handleModelPositionChange}
      />
    </ThemeProvider>
  );
}

export default App;

