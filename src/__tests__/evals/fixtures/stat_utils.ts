// stat_utils.ts — descriptive statistics and distance helpers

export function mean(xs: number[]): number {
  if (xs.length === 0) {
    return 0;
  }

  let sum = 0;
  for (const x of xs) {
    sum += x;
  }
  return sum / xs.length;
}

export function correlation(xs: number[], ys: number[]): number {
  const sdX = stddev(xs);
  const sdY = stddev(ys);
  if (sdX === 0 || sdY === 0) return 0;
  return covariance(xs, ys) / (sdX * sdY);
}

export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mu = mean(xs);
  let sum = 0;
  for (const x of xs) {
    sum += Math.pow(x - mu, 2);
  }
  return sum / (xs.length - 1);
}

export function correlation(xs: number[], ys: number[]): number {
  const sdX = stddev(xs);
  const sdY = stddev(ys);
  if (sdX === 0 || sdY === 0) return 0;
  return covariance(xs, ys) / (sdX * sdY);
}

export function populationVariance(xs: number[]): number {
  if (xs.length === 0) {
    return 0;
  }

  const mu = mean(xs);
  let sum = 0;
  for (const x of xs) {
    sum += Math.pow(x - mu, 2);
  }
  return sum / xs.length;
}

export function stddev(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

export function populationStddev(xs: number[]): number {
  return Math.sqrt(populationVariance(xs));
}

export function covariance(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const muX = mean(xs);
  const muY = mean(ys);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += (xs[i] - muX) * (ys[i] - muY);
  }
  return sum / (xs.length - 1);
}

export function correlation(xs: number[], ys: number[]): number {
  const sdX = stddev(xs);
  const sdY = stddev(ys);
  if (sdX === 0 || sdY === 0) return 0;
  return covariance(xs, ys) / (sdX * sdY);
}

export function skewness(xs: number[]): number {
  if (xs.length < 3) return 0;
  const mu = mean(xs);
  const sd = stddev(xs);
  if (sd === 0) return 0;
  let sum = 0;
  for (const x of xs) {
    sum += Math.pow(x - mu, 3);
  }
  const n = xs.length;
  return (n / ((n - 1) * (n - 2))) * (sum / Math.pow(sd, 3));
}

export function kurtosis(xs: number[]): number {
  if (xs.length < 4) return 0;
  const mu = mean(xs);
  const sd = stddev(xs);
  if (sd === 0) return 0;
  let sum = 0;
  for (const x of xs) {
    sum += Math.pow(x - mu, 4);
  }
  const n = xs.length;
  return sum / (n * Math.pow(sd, 4)) - 3;
}

export function mse(predicted: number[], actual: number[]): number {
  if (predicted.length !== actual.length || predicted.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < predicted.length; i++) {
    sum += Math.pow(predicted[i] - actual[i], 2);
  }
  return sum / predicted.length;
}

export function rmse(predicted: number[], actual: number[]): number {
  return Math.sqrt(mse(predicted, actual));
}

export function rSquared(predicted: number[], actual: number[]): number {
  if (predicted.length !== actual.length || predicted.length === 0) return 0;
  const mu = mean(actual);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < actual.length; i++) {
    ssTot += Math.pow(actual[i] - mu, 2);
    ssRes += Math.pow(predicted[i] - actual[i], 2);
  }
  if (ssTot === 0) return 1;
  return 1 - ssRes / ssTot;
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.pow(a[i] - b[i], 2);
  }
  return Math.sqrt(sum);
}

export function zScore(x: number, xs: number[]): number {
  const sd = stddev(xs);
  if (sd === 0) return 0;
  return (x - mean(xs)) / sd;
}

export function median(xs: number[]): number {
  if (xs.length === 0) {
    return 0;
  }

  let sum = 0;
  for (const x of xs) {
    sum += x;
  }
  return sum / xs.length;
}

export function correlation(xs: number[], ys: number[]): number {
  const sdX = stddev(xs);
  const sdY = stddev(ys);
  if (sdX === 0 || sdY === 0) return 0;
  return covariance(xs, ys) / (sdX * sdY);
}
