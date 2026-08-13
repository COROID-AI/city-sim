const fs = require('fs');

let data = fs.readFileSync('package-lock.json', 'utf8');
// Split by the conflict marker pattern, but we want to keep the markers as separators.
// We'll use a regex to split and keep the delimiters.
const regex = /(<<<<<<< HEAD\n[\s\S]*?\n=======\n[\s\S]*?\n>>>>>>> origin\/feature\/coroid-12e5c6-create-basic-scene-orbit)/g;
const parts = data.split(regex);

// Now parts array: [non-conflict1, conflict1, non-conflict2, conflict2, ...]
let newParts = [];
for (let i = 0; i < parts.length; i++) {
  if (i % 2 === 0) {
    // non-conflict part
    newParts.push(parts[i]);
  } else {
    // conflict part
    const conflict = parts[i];
    // Extract the head and feature sections.
    const headMatch = conflict.match(/<<<<<<< HEAD\n([\s\S]*?)\n=======/);
    const featureMatch = conflict.match(/=======\n([\s\S]*?)\n>>>>>>> origin\/feature\/coroid-12e5c6-create-basic-scene-orbit/);
    if (!headMatch || !featureMatch) {
      // malformed, keep as is
      newParts.push(conflict);
      continue;
    }
    let headSection = headMatch[1];
    let featureSection = featureMatch[1];

    // Check if this is the top-level name conflict: headSection is just the name line.
    const headTrimmed = headSection.trim();
    const featureTrimmed = featureSection.trim();
    if (headTrimmed === '"name": "city-time-period-timelapse",' && 
        featureTrimmed === '"name": "repository",') {
      // Top-level name: choose head side.
      newParts.push(headSection);
    } else if (headSection.includes('"name": "city-time-period-timelapse",') && 
               featureSection.includes('"name": "repository",')) {
      // This is the "" package name conflict.
      // We want to take the name from head and the rest from feature.
      // Split featureSection into lines.
      const featureLines = featureSection.split('\n');
      // Find the line that contains the name.
      for (let j = 0; j < featureLines.length; j++) {
        if (featureLines[j].trim().includes('"name": "repository",')) {
          // Replace that line with the head's name line.
          // We assume the headSection has the name line as its first line? Actually, we just want to put the head's name line.
          // Extract the name line from headSection.
          const headNameLine = headSection.split('\n').find(line => line.trim().includes('"name": "city-time-period-timelapse",'));
          if (headNameLine) {
            featureLines[j] = headNameLine;
          }
          break;
        }
      }
      featureSection = featureLines.join('\n');
      newParts.push(featureSection);
    } else {
      // For all other conflicts, choose the feature side.
      newParts.push(featureSection);
    }
  }
}

let newData = newParts.join('');
fs.writeFileSync('package-lock.json.new', newData);
console.log('Merge completed, output to package-lock.json.new');
