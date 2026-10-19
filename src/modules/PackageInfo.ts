export interface PackageInfo {
    name: string;
    version?: string;
    latestVersion?: string;
}

export function createPackageInfo(pack: string | PackageInfo): PackageInfo | null {
    const info = typeof pack === 'string' ? parsePackageSpec(pack) : { ...pack };
    if (!info.name) {
        return null;
    }
    info.toString = () => `${info.name}${info.version ? `==${info.version}` : ''}`;
    return info;
}

function parsePackageSpec(spec: string): PackageInfo {
    const [name, version] = spec.split('==');
    return { name, version: version || undefined };
}

function numericPart(part = '0'): number {
    return parseInt(part.replace(/[^0-9]/g, '')) || 0;
}

/** Preserve the existing numeric version ordering, including suffix handling. */
export function comparePackageVersions(a: string, b: string): number {
    const partsA = a.split('.');
    const partsB = b.split('.');
    for (let index = 0; index < Math.max(partsA.length, partsB.length); index++) {
        const difference = numericPart(partsB[index]) - numericPart(partsA[index]);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
}
