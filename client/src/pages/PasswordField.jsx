import PasswordInput from '../components/common/PasswordInput.jsx';

/**
 * A labelled password field for the sign-in pages: the label above, and the input with
 * the eye button inside it to show or hide what was typed.
 */
export default function PasswordField({ label = 'Password', ...inputProps }) {
  return (
    <label className="auth__field">
      {label}
      <PasswordInput {...inputProps} />
    </label>
  );
}
