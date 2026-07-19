///|
pub(all) suberror DecodeError {
  Empty
  Unknown(Byte)
} derive(Debug)

///|
pub fn decode_tag(packet : Bytes) -> String raise {
  match packet[0] {
    b'\x01' => "ping"
    b'\x02' => "pong"
    tag => fail("unknown tag \{tag}")
  }
}
