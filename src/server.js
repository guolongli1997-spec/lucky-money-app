import { Agent, callable } from "agents";

export class CounterAgent extends Agent {
	initialState = { count: 0 };

	@callable()
	increment(by) {
		if (!Number.isInteger(by)) throw new Error("by must be an integer");
		this.setState({ count: this.state.count + by });
		return this.state.count;
	}

	// Not decorated, so clients cannot call it.
	reset() {
		this.setState({ count: 0 });
	}
}
