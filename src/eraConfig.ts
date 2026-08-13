// Define the EraConfig interface
export interface EraConfig {
  buildings: {
    height: number; // average height in meters
    style: string; // architectural style
    materials: string[]; // common building materials
  };
  vehicles: {
    types: string[]; // common vehicle types
    models: string[]; // popular vehicle models
  };
  storefronts: {
    architecturalStyle: string; // style of shop fronts
    materials: string[]; // materials used in storefronts
  };
  advertisements: {
    style: string; // advertising style
    content: string; // typical ad content/theme
  };
  pedestrianOutfits: {
    clothingStyles: string[]; // common clothing styles for pedestrians
  };
}

// Export configuration objects for each era
export const era1945: EraConfig = {
  buildings: {
    height: 15, // 3-4 stories typical
    style: "Art Deco and early Modernism",
    materials: ["brick", "concrete", "steel", "limestone"]
  },
  vehicles: {
    types: ["car", "bus", "truck", "motorcycle", "bicycle"],
    models: ["Ford Super Deluxe", "Chevrolet Fleetline", "Volkswagen Beetle", "Hudson Commodore"]
  },
  storefronts: {
    architecturalStyle: "Art Deco with glass blocks",
    materials: ["glass", "chrome", "brick", "limestone"]
  },
  advertisements: {
    style: "Bold, patriotic, and product-focused",
    content: "War bonds, household appliances, automobiles, cigarettes"
  },
  pedestrianOutfits: {
    clothingStyles: [
      "Men: suits, fedoras, trench coats",
      "Women: dresses, gloves, victory rolls hairstyle",
      "Children: knitwear, short pants, cap"
    ]
  }
};

export const era1965: EraConfig = {
  buildings: {
    height: 30, // 6-8 stories, rise of skyscrapers
    style: "International Style and Brutalism",
    materials: ["concrete", "steel", "glass", "precast panels"]
  },
  vehicles: {
    types: ["car", "bus", "truck", "motorcycle", "bicycle"],
    models: ["Ford Mustang", "Chevrolet Impala", "Volkswagen Beetle", "Toyota Corona"]
  },
  storefronts: {
    architecturalStyle: "Mid-century modern with large display windows",
    materials: ["glass", "aluminum", "concrete", "colored panels"]
  },
  advertisements: {
    style: "Optimistic, colorful, and consumer-focused",
    content: "Space race, television, fast food, cars, household gadgets"
  },
  pedestrianOutfits: {
    clothingStyles: [
      "Men: slim suits, turtlenecks, casual sports jackets",
      "Women: miniskirts, shift dresses, go-go boots, bouffant hair",
      "Children: bright colors, denim, t-shirts"
    ]
  }
};

export const era1985: EraConfig = {
  buildings: {
    height: 50, // 10-12 stories, postmodernism
    style: "Postmodern and High-tech",
    materials: ["steel", "glass", "concrete", "granite", "aluminum panels"]
  },
  vehicles: {
    types: ["car", "bus", "truck", "motorcycle", "bicycle"],
    models: ["Ford Taurus", "Honda Accord", "Toyota Camry", "Chevrolet Cavalier"]
  },
  storefronts: {
    architecturalStyle: "Postmodern with eclectic elements",
    materials: ["glass", "metal", "stone", "stucco", "tiles"]
  },
  advertisements: {
    style: "Glitzy, brand-focused, and MTV-influenced",
    content: "Personal computers, video games, fitness, designer brands, soda"
  },
  pedestrianOutfits: {
    clothingStyles: [
      "Men: power suits, polo shirts, casual loafers",
      "Women: shoulder pads, mini skirts, leggings, big hair",
      "Children: neon colors, windbreakers, high-top sneakers"
    ]
  }
};

export const era2005: EraConfig = {
  buildings: {
    height: 45, // 9-10 stories, sustainable design emerging
    style: "Contemporary and Sustainable",
    materials: ["steel", "glass", "concrete", "recycled materials", "low-e glass"]
  },
  vehicles: {
    types: ["car", "bus", "truck", "motorcycle", "bicycle", "hybrid"],
    models: ["Toyota Corolla", "Honda Civic", "Ford F-150", "Toyota Prius"]
  },
  storefronts: {
    architecturalStyle: "Minimalist and transparent",
    materials: ["glass", "steel", "concrete", "wood accents", "composite panels"]
  },
  advertisements: {
    style: "Digital, targeted, and experience-driven",
    content: "Smartphones, social media, online shopping, SUVs, coffee chains"
  },
  pedestrianOutfits: {
    clothingStyles: [
      "Men: casual jeans, polo shirts, sneakers",
      "Women: bootcut jeans, tops, flip-flops or ballet flats",
      "Children: graphic tees, cargo shorts, sneakers"
    ]
  }
};

export const era2025: EraConfig = {
  buildings: {
    height: 40, // 8-9 stories, mixed-use and green buildings
    style: "Parametric and Eco-friendly",
    materials: ["cross-laminated timber", "recycled steel", "smart glass", "living walls", "solar panels"]
  },
  vehicles: {
    types: ["car", "bus", "truck", "motorcycle", "bicycle", "electric", "scooter"],
    models: ["Tesla Model 3", "Toyota RAV4", "Ford F-150 Lightning", "Chevrolet Bolt"]
  },
  storefronts: {
    architecturalStyle: "Adaptive reuse with digital integration",
    materials: ["reclaimed wood", "glass", "steel", "concrete", "LED displays"]
  },
  advertisements: {
    style: "Personalized, interactive, and sustainability-focused",
    content: "Electric vehicles, renewable energy, plant-based foods, streaming services, metaverse"
  },
  pedestrianOutfits: {
    clothingStyles: [
      "Men: athleisure, sustainable brands, smart casual",
      "Women: leggings, oversized blouses, sustainable dresses",
      "Children: gender-neutral clothing, durable sneakers, tech-integrated wearables"
    ]
  }
};

// Export all eras as an object for convenience
export const eras = {
  1945: era1945,
  1965: era1965,
  1985: era1985,
  2005: era2005,
  2025: era2025
};

// Default export for convenience (only values, not types)
export default {
  era1945,
  era1965,
  era1985,
  era2005,
  era2025,
  eras
};