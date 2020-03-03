export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.substring(1);
}

export const groupBy = (array, key) =>
  array.reduce(
    (objectsByKeyValue, obj) => ({
      ...objectsByKeyValue,
      [obj[key]]: (objectsByKeyValue[obj[key]] || []).concat(obj)
    }),
    {}
  );
