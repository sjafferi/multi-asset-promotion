const fs = require('fs');

const NUM_NAME_BUCKETS = 20;
const NUM_CORRELATION_BUCKETS = 3;
const ENVIRONMENTS = ["dev", "qa", "stag", "prod", "us2", "us1"];

function generateAssets(numAssets) {
  const numNames = parseInt(numAssets / NUM_NAME_BUCKETS);
  const numCorrKeys = parseInt(numNames * 0.75);
  const names = generateNames(numNames);
  const corrKeys = generateCorrelationKeys(numCorrKeys);

  // add all correlation keys for each name
  const assets = names.reduce((acc, name) => {
    return acc.concat(corrKeys.map((corrKey) => ({
      corrKey,
      name,
      id: generateId(),
      env: generateEnv()
    })))
  }, []);

  if (numAssets > assets.length) {
    // randomly assign remaining assets
    [...Array(numAssets - assets.length)].forEach((_, index) => {
      const name = names[generateRandomInteger(0, names.length - 1)];
      const corrKey = corrKeys[generateRandomInteger(0, corrKeys.length - 1)];
      assets.push({
        corrKey,
        name,
        id: generateId(),
        env: generateEnv()
      });
    });
  }

  return assets;
}

function generateNames(numNames) {
  return [...Array(numNames)].map((_, index) => "Name-" + index);
}

function generateCorrelationKeys(numCorrKeys) {
  return [...Array(numCorrKeys)].map((_, index) => "Corr-Key-" + index);
}

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function generateEnv() {
  return ENVIRONMENTS[generateRandomInteger(0, ENVIRONMENTS.length - 1)]
}

function generateRandomInteger(min, max) {
  return Math.round(Math.random() * (max - min) + min);
}

function writeFile(filePath, data) {
  return fs.writeFile(
    filePath,
    JSON.stringify(data),
    function (err) {
      if (err) {
        console.error('Save unsuccesfull');
      } else {
        console.log("Save succesfull!")
      }
    }
  );
}

// console.log(generateAssets(100))
writeFile("./assets.json", generateAssets(100));