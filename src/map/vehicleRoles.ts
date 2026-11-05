/**
 * Which cars of a consist a part belongs to. A train has a cab at each end: its tail car is a
 * lead car turned round, with red lights. CENTRE marks the middle car (a tram's pantograph).
 *
 * Apart from vehicleShapes so that the renderer can use it without loading Three.js at startup.
 */
export const LEAD = 1, MIDDLE = 2, TAIL = 4, SINGLE = 8, CENTRE = 16, EVERY = 31;
export function carRole(car: number, count: number) {
  const role = count === 1 ? SINGLE : car === 0 ? LEAD : car === count - 1 ? TAIL : MIDDLE;
  return role | (count > 1 && car === Math.floor(count / 2) ? CENTRE : 0);
}
