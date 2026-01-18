export interface WalkmeshVertex {
  x: number;
  y: number;
  z: number;
}

export interface WalkmeshTriangle {
  vertices: [WalkmeshVertex, WalkmeshVertex, WalkmeshVertex];
  access: [number, number, number]; // Adjacent triangle IDs (0xFFFF = blocked)
}

export interface Walkmesh {
  triangleCount: number;
  triangles: WalkmeshTriangle[];
}

export function parseWalkmesh(buffer: number[]): Walkmesh {
  if (buffer.length < 4) {
    return { triangleCount: 0, triangles: [] };
  }

  const readInt16 = (offset: number): number => {
    const val = buffer[offset] | (buffer[offset + 1] << 8);
    return val > 0x7FFF ? val - 0x10000 : val;
  };

  const readUInt16 = (offset: number): number => {
    return buffer[offset] | (buffer[offset + 1] << 8);
  };

  const readUInt32 = (offset: number): number => {
    return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24);
  };

  const triangleCount = readUInt32(0);
  
  if (triangleCount === 0 || triangleCount > 10000) {
    return { triangleCount: 0, triangles: [] };
  }

  const sectorPoolOffset = 4;
  const accessPoolOffset = sectorPoolOffset + triangleCount * 24;

  const triangles: WalkmeshTriangle[] = [];

  for (let i = 0; i < triangleCount; i++) {
    const sectorOffset = sectorPoolOffset + i * 24;
    const accessOffset = accessPoolOffset + i * 6;

    const vertices: [WalkmeshVertex, WalkmeshVertex, WalkmeshVertex] = [
      {
        x: readInt16(sectorOffset),
        y: readInt16(sectorOffset + 2),
        z: readInt16(sectorOffset + 4),
      },
      {
        x: readInt16(sectorOffset + 8),
        y: readInt16(sectorOffset + 10),
        z: readInt16(sectorOffset + 12),
      },
      {
        x: readInt16(sectorOffset + 16),
        y: readInt16(sectorOffset + 18),
        z: readInt16(sectorOffset + 20),
      },
    ];

    const access: [number, number, number] = [
      readUInt16(accessOffset),
      readUInt16(accessOffset + 2),
      readUInt16(accessOffset + 4),
    ];

    triangles.push({ vertices, access });
  }

  return { triangleCount, triangles };
}

export interface Gateway {
  vertex1: WalkmeshVertex;
  vertex2: WalkmeshVertex;
  fieldId: number;
}

export function parseGateways(buffer: number[]): Gateway[] {
  if (buffer.length < 344) {
    return [];
  }

  const readInt16 = (offset: number): number => {
    const val = buffer[offset] | (buffer[offset + 1] << 8);
    return val > 0x7FFF ? val - 0x10000 : val;
  };

  const readUInt16 = (offset: number): number => {
    return buffer[offset] | (buffer[offset + 1] << 8);
  };

  const gateways: Gateway[] = [];
  const gatewayOffset = 56;

  for (let i = 0; i < 12; i++) {
    const offset = gatewayOffset + i * 24;

    const fieldId = readUInt16(offset + 18);
    if (fieldId === 0) continue;

    const vertex1: WalkmeshVertex = {
      x: readInt16(offset),
      y: readInt16(offset + 2),
      z: readInt16(offset + 4),
    };

    const vertex2: WalkmeshVertex = {
      x: readInt16(offset + 6),
      y: readInt16(offset + 8),
      z: readInt16(offset + 10),
    };

    if (vertex1.x === 0 && vertex1.y === 0 && vertex2.x === 0 && vertex2.y === 0) continue;

    gateways.push({ vertex1, vertex2, fieldId });
  }

  return gateways;
}

export function calculateWalkmeshBounds(walkmesh: Walkmesh): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerY: number;
  centerZ: number;
} {
  if (walkmesh.triangles.length === 0) {
    return {
      minX: 0, maxX: 0,
      minY: 0, maxY: 0,
      minZ: 0, maxZ: 0,
      centerX: 0, centerY: 0, centerZ: 0,
    };
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const tri of walkmesh.triangles) {
    for (const v of tri.vertices) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
      minZ = Math.min(minZ, v.z);
      maxZ = Math.max(maxZ, v.z);
    }
  }

  return {
    minX, maxX,
    minY, maxY,
    minZ, maxZ,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
}

