///|
pub trait Codec {
  encode(Self) -> String
}

///|
pub trait BuiltinCodec {
  builtin_name(Self) -> String
}

///|
pub(all) struct JsonCodec {}

///|
impl Codec for JsonCodec with encode(_self) {
  "json"
}

///|
impl BuiltinCodec for JsonCodec with builtin_name(_self) {
  "json"
}

///|
pub fn encode_json() -> String {
  Codec::encode(JsonCodec::{})
}

///|
pub fn builtin_json_name() -> String {
  BuiltinCodec::builtin_name(JsonCodec::{})
}
