-- Preserve the historical migration checksum; apply the token-expiry fix forward.
CREATE OR REPLACE FUNCTION kalo_redeem_password_reset(p_token_hash text, p_new_hash text) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM password_reset_tokens WHERE token_hash = p_token_hash AND expires_at > now();
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM users WHERE id = v_user FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Explicitly consume the token even if the supplied hash equals the old hash.
  DELETE FROM password_reset_tokens WHERE user_id = v_user AND token_hash = p_token_hash AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE users SET password_hash = p_new_hash WHERE id = v_user;
  RETURN true;
END;
$$;
