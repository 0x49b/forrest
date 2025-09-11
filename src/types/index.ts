export interface PackageJson {
    name: string;
    version: string;
    description?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    homepage?: string;
    repository?: {
        type: string;
        url: string;
    };
    license?: string;
}

export interface DependencyNode {
    name: string;
    version: string;
    description?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    homepage?: string;
    repository?: {
        type: string;
        url: string;
    };
    license?: string;
    loaded: boolean;
    loading: boolean;
    hasNoDependencies?: boolean;
}

export interface BreadcrumbItem {
    name: string;
    version: string;
}

export interface LoadingProgress {
    current: number;
    total: number;
    level: number;
    currentPackage?: string;
}