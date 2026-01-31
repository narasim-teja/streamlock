/// StreamLock error codes
module streamlock::errors {
    /// Creator is not registered
    const E_NOT_REGISTERED: u64 = 1;

    /// Creator is already registered
    const E_ALREADY_REGISTERED: u64 = 2;

    /// Video not found
    const E_VIDEO_NOT_FOUND: u64 = 3;

    /// Video is not active
    const E_VIDEO_NOT_ACTIVE: u64 = 4;

    /// Session not found
    const E_SESSION_NOT_FOUND: u64 = 5;

    /// Session has expired
    const E_SESSION_EXPIRED: u64 = 6;

    /// Invalid segment index
    const E_INVALID_SEGMENT_INDEX: u64 = 7;

    /// Insufficient balance
    const E_INSUFFICIENT_BALANCE: u64 = 8;

    /// Unauthorized operation
    const E_UNAUTHORIZED: u64 = 9;

    /// Invalid Merkle proof
    const E_INVALID_PROOF: u64 = 10;

    /// Dispute already exists
    const E_DISPUTE_EXISTS: u64 = 11;

    /// Invalid commitment
    const E_INVALID_COMMITMENT: u64 = 12;

    /// Protocol is paused
    const E_PROTOCOL_PAUSED: u64 = 13;

    /// Price below minimum
    const E_PRICE_TOO_LOW: u64 = 14;

    /// Segment already paid
    const E_SEGMENT_ALREADY_PAID: u64 = 15;

    // Public getters for error codes
    public fun not_registered(): u64 { E_NOT_REGISTERED }
    public fun already_registered(): u64 { E_ALREADY_REGISTERED }
    public fun video_not_found(): u64 { E_VIDEO_NOT_FOUND }
    public fun video_not_active(): u64 { E_VIDEO_NOT_ACTIVE }
    public fun session_not_found(): u64 { E_SESSION_NOT_FOUND }
    public fun session_expired(): u64 { E_SESSION_EXPIRED }
    public fun invalid_segment_index(): u64 { E_INVALID_SEGMENT_INDEX }
    public fun insufficient_balance(): u64 { E_INSUFFICIENT_BALANCE }
    public fun unauthorized(): u64 { E_UNAUTHORIZED }
    public fun invalid_proof(): u64 { E_INVALID_PROOF }
    public fun dispute_exists(): u64 { E_DISPUTE_EXISTS }
    public fun invalid_commitment(): u64 { E_INVALID_COMMITMENT }
    public fun protocol_paused(): u64 { E_PROTOCOL_PAUSED }
    public fun price_too_low(): u64 { E_PRICE_TOO_LOW }
    public fun segment_already_paid(): u64 { E_SEGMENT_ALREADY_PAID }
}
