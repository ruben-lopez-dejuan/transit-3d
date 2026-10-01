import "./style.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="shell">
    <p class="eyebrow">BILBAO TRANSIT 3D</p>
    <h1>Transit data foundation ready</h1>
    <p>
      Bizkaibus static GTFS is handled by the backend provider.
      Next: GTFS-Realtime and the live map.
    </p>
  </main>
`;
