#alias(Voice)
pub trait Speak { say(Self) -> String }
pub fn[T : Voice] describe(value : T) -> String { value.say() }
