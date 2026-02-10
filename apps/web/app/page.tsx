import { sum } from "../src/lib/sum";

export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "serif" }}>
      <h1>Moe's Tavern</h1>
      <p>Marketplace scaffold is live.</p>
      <p>Sanity check: 2 + 3 = {sum(2, 3)}</p>
    </main>
  );
}
