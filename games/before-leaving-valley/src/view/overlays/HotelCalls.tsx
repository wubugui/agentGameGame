/* The local phone book and her own notebook page: twenty-odd numbers, one answer. */
import { formatGameTime } from "../../phoneModel";
import { useWorldContext, useWorldValue } from "../useWorld";

export const HOTEL_CALLS = [
  "山口边的旅馆", "山口的山屋", "缆车站的餐厅", "Canazei 游客中心", "Canazei 的一家 Garni", "湖边的旅馆", "教堂旁的 Pensione",
  "河对岸的 Residence", "Campitello 游客中心", "Campitello 的一家 Hotel", "Val Lasties 谷口的旅馆", "Sassolungo 脚下的 Chalet",
  "Col Rodella 缆车站", "Alba 的一家 Albergo", "Penia 的民宿", "Passo Pordoi 的山屋", "Selva 游客中心", "Selva 的一家 Hotel",
  "Plan de Gralba 的旅馆", "Val di Fassa 旅游局", "警局总机（无人接听）", "山地救援值班室",
];
const ANSWERS = ["“No, sorry.”", "“Nessun telefono qui.”", "“没有人捡到。”", "“Non lo so.”", "“Mi dispiace.”"];

export function HotelCalls() {
  const world = useWorldContext();
  const called = useWorldValue((s) => ((s.flags["hotel.called"] as string | null) ?? "").split(",").filter(Boolean));
  const minute = useWorldValue((s) => s.clock.minuteOfDay);
  return (
    <div className="paper-overlay" role="dialog" aria-modal="true" aria-label="打电话" onPointerDown={(event) => { if (event.target === event.currentTarget) world.dispatch({ type: "overlay:close" }); }}>
      <div className="hotel-sheet">
        <header><strong>本子这一页 · 能问的地方</strong><span>已打 {called.length} 个 · {formatGameTime(minute)}</span></header>
        <ul>
          {HOTEL_CALLS.map((name, index) => {
            const done = called.includes(String(index));
            return <li key={name}><button className={done ? "called" : ""} onClick={() => !done && world.dispatch({ type: "ui:action", id: "hotel:call", value: index })}><span>{name}</span><b>{done ? ANSWERS[index % ANSWERS.length] : "拨打"}</b></button></li>;
          })}
        </ul>
        <button className="primary-button map-close" onClick={() => world.dispatch({ type: "ui:action", id: "hotel:hangup" })}>放下电话</button>
      </div>
    </div>
  );
}
