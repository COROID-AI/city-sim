// Era configuration data structure for city timelapse
// Defines historical era settings for buildings, vehicles, storefronts,
// advertisements, and pedestrian outfits

export interface BuildingConfig {
  height: number; // stories
  style: string; // architectural style
  materials: string[]; // primary materials
}

export interface VehicleConfig {
  types: string[]; // vehicle type categories
  models: string[]; // specific model names
}

export interface StorefrontConfig {
  architecturalStyle: string;
  materials: string[];
}

export interface AdvertisementConfig {
  style: string;
  content: string;
}

export interface PedestrianOutfit {
  clothingStyles: string[];
}

export interface EraConfig {
  name: string;
  year: number;
  buildings: BuildingConfig;
  vehicles: VehicleConfig;
  storefronts: StorefrontConfig;
  advertisements: AdvertisementConfig;
  pedestrianOutfits: PedestrianOutfit;
}

// 1945 - Post-war era: rebuilding, Art Deco transition, classic cars
export const era1945: EraConfig = {
  name: "1945",
  year: 1945,
  buildings: {
    height: 2,
    style: "Art Deco/Traditional",
    materials: ["brick", "concrete", "steel"],
  },
  vehicles: {
    types: ["classic car", "truck", "military vehicle"],
    models: ["Ford V8", "Chevy Deluxe", "Willys Jeep"],
  },
  storefronts: {
    architecturalStyle: "Traditional",
    materials: ["wood", "glass", "metal"],
  },
  advertisements: {
    style: "Retro",
    content: "Post-war recovery, building future",
  },
  pedestrianOutfits: {
    clothingStyles: ["utility suits", "wartime dresses", "military uniforms"],
  },
};

// 1965 - Mid-century modern: economic growth, modernism
export const era1965: EraConfig = {
  name: "1965",
  year: 1965,
  buildings: {
    height: 4,
    style: "Mid-Century Modern",
    materials: ["steel", "glass", "concrete"],
  },
  vehicles: {
    types: ["muscle car", "compact", "truck"],
    models: ["Ford Mustang", "Chevrolet Impala", "Volkswagen Beetle"],
  },
  storefronts: {
    architecturalStyle: "Mid-Century Modern",
    materials: ["aluminum", "glass", "formica"],
  },
  advertisements: {
    style: "Space Age",
    content: "Future through technology",
  },
  pedestrianOutfits: {
    clothingStyles: ["1960s mod fashion", "shift dresses", "suits with narrow ties"],
  },
};

// 1985 - 1980s: neon, economic shifts, post-industrial
export const era1985: EraConfig = {
  name: "1985",
  year: 1985,
  buildings: {
    height: 5,
    style: "Post-Modern",
    materials: ["glass", "steel", "brick"],
  },
  vehicles: {
    types: ["80s car", "truck", "import"],
    models: ["DeLorean", "Ford F-150", "Toyota Corolla"],
  },
  storefronts: {
    architecturalStyle: "Commercial 80s",
    materials: ["aluminum", "neon glass", "plastic"],
  },
  advertisements: {
    style: "Neon",
    content: "Consumer culture, excess",
  },
  pedestrianOutfits: {
    clothingStyles: ["power suits", "shoulder pads", "leg warmers"],
  },
};

// 2005 - Digital age: early 2000s, tech boom
export const era2005: EraConfig = {
  name: "2005",
  year: 2005,
  buildings: {
    height: 10,
    style: "Contemporary",
    materials: ["glass", "steel", "curtain wall"],
  },
  vehicles: {
    types: ["car", "SUV", "hybrid"],
    models: ["Toyota Prius", "Ford Mustang", "Honda Civic"],
  },
  storefronts: {
    architecturalStyle: "Early 2000s Commercial",
    materials: ["glass", "aluminum", "stone veneer"],
  },
  advertisements: {
    style: "Digital",
    content: "Early internet, connectivity",
  },
  pedestrianOutfits: {
    clothingStyles: ["early 2000s casual", "denim dominant", "track suits"],
  },
};

// 2025 - Near-future: sustainable, smart city, high-tech
export const era2025: EraConfig = {
  name: "2025",
  year: 2025,
  buildings: {
    height: 30,
    style: "Sustainable/High-Tech",
    materials: ["smart glass", "carbon fiber", "green concrete"],
  },
  vehicles: {
    types: ["electric", "autonomous", "futuristic"],
    models: ["Tesla Model Q", "Autonomous Shuttle", "eVTOL"],
  },
  storefronts: {
    architecturalStyle: "Smart Storefront",
    materials: ["interactive glass", "recycled materials", "living walls"],
  },
  advertisements: {
    style: "Programmatic/AR",
    content: "Real-time personalized, immersive",
  },
  pedestrianOutfits: {
    clothingStyles: ["modular fashion", "tech-integrated", "sustainable fabrics"],
  },
};

export const eras = [era1945, era1965, era1985, era2005, era2025];
export default eras;