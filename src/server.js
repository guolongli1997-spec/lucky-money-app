import { Agent, callable } from "agents";

export type CounterState = { count: number };

export class CounterAgent extends Agent<Env, CounterState> {
	initialState: CounterState = { count: 0 };

	@callable()
	increment(by: number): number {
		if (!Number.isInteger(by)) throw new Error("by must be an integer");
		this.setState({ count: this.state.count + by });
		return this.state.count;
	}

	// Not decorated, so clients cannot call it.
	reset() {
		this.setState({ count: 0 });
	}
}