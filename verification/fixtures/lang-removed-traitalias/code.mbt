pub trait Speak { say(Self) -> String }
traitalias Speak as Voice
pub fn[T : Voice] describe(value : T) -> String { value.say() }
