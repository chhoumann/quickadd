// The first date format on a machine pages Node's ICU data in from disk, and
// every later process shares those pages. On Windows CI that read can stall a
// test past its timeout while the first wave of workers loads, so pay it here,
// once, before any worker starts.
export default function warmIcuData(): void {
	new Date(0).toLocaleDateString();
}
