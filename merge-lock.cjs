const fs = require('fs');
const path = require('path');

const filePath = 'package-lock.json';
let content = fs.readFileSync(filePath, 'utf8');

// Regex to match a conflict block: <<<<<<< HEAD, then any content (non-greedy) until =======, then any content until >>>>>>>
const conflictRegex = /<<<<<<< HEAD\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> origin\/feature\/coroid-12e5c6-create-basic-scene-orbit/g;

// We'll replace each conflict block with our resolution.
const resolved = content.replace(conflictRegex, (match, headContent, featureContent) => {
  // Determine which conflict this is by looking at the content.

  // If the headContent is just the top-level name line (and maybe whitespace) and featureContent is the other name.
  const trimmedHead = headContent.trim();
  const trimmedFeature = featureContent.trim();

  if (trimmedHead === '"name": "city-time-period-timelapse",' && 
      trimmedFeature === '"name": "repository",') {
    // Top-level name: choose head.
    return headContent;
  }

  // Check if this is the "" package block: both sides have a "name" line and then dependencies.
  if (headContent.includes('"name": "city-time-period-timelapse",') && 
      featureContent.includes('"name": "repository",')) {
    // We want to take the name from head and the rest from feature.
    // We'll take the featureContent and replace its name line with the head's name line.
    const featureLines = featureContent.split('\n');
    for (let i = 0; i < featureLines.length; i++) {
      if (featureLines[i].trim().includes('"name": "repository",')) {
        // Replace this line with the head's name line.
        // We assume the headContent has the name line as its first line? Let's extract the name line from headContent.
        const headNameLine = headContent.split('\n').find(line => line.trim().includes('"name": "city-time-period-timelapse",'));
        if (headNameLine) {
          featureLines[i] = headNameLine;
        }
        break;
      }
    }
    return featureLines.join('\n');
  }

  // For all other conflicts, choose the feature side.
  return featureContent;
});

fs.writeFileSync(filePath, resolved);
console.log('Merge completed');