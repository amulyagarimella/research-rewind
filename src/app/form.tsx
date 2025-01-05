import { useEffect, useState, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';

const FormComponent = ({ subjects, intervals }) => {
  interface FormData {
    name: string;
    email: string;
    subscribed: boolean;
    userIntervals: Number[];
    userSubjects: string[];
  }
  
  const defaults = {
    name: "",
    email: "",
    subscribed: true,
    userIntervals: [] as Number[],
    userSubjects: [] as string[],
  }

  const [selectAllIntervalsChecked, setSelectAllIntervalsChecked] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { control, handleSubmit, reset, watch, setValue } = useForm<FormData>({
    defaultValues: defaults,
  });

  // const {register, handleSubmit, formState: { errors }, reset} = useForm();

  const watchedSubjects: string[] = watch("userSubjects", []);
  const watchedIntervals: Number[] = watch("userIntervals", []);


  const togglefields = (parentId, checked) => {
    const subdomainIds = subjects.find((domain) => domain.id === parentId)?.fields.map((sub) => sub.id) || [];
    let updatedSubjects: string[] = [...watchedSubjects];

    if (checked) {
      updatedSubjects = [...new Set([...updatedSubjects, parentId, ...subdomainIds])];
    } else {
      updatedSubjects = updatedSubjects.filter((id) => id !== parentId && !subdomainIds.includes(id));
    }
    setValue("userSubjects", updatedSubjects);
    console.log(updatedSubjects);
  };

  const onSubmit = async (data) => {
    try {
      console.log("Form data:", data); // Debugging line to check form data
      const response = await fetch('/api/submitForm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        reset(defaults, {
          keepValues: false,
        });
        setSelectAllIntervalsChecked(false); // Uncheck the "Select all" button
        setIsSubmitted(true); // Show thank you message
      } else {
        console.error('Error submitting form');
      }
    } catch (error) {
      console.error('Error submitting form: ', error);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div>
        <label htmlFor="name" className="main">Name</label>
        <Controller
          name="name"
          control={control}
          rules={{ required: "Name is required" }}
          render={({ field, fieldState }) => (
            <>
              <input id="name" placeholder="Name" {...field} />
              {fieldState.error && <p className="error">{fieldState.error.message}</p>}
            </>
          )}
        />
      </div>

      <div>
        <label htmlFor="email" className="main">Email</label>
        <Controller
          name="email"
          control={control}
          rules={{ required: "Email is required", pattern: { value: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, message: "Invalid email format" } }}
          render={({ field, fieldState }) => (
            <>
              <input id="email" placeholder="Email" {...field} />
              {fieldState.error && <p className="error">{fieldState.error.message}</p>}
            </>
          )}
        />
      </div>


        <div>
            <label className="main">Years back</label>
            <label key="all">
                <input
                type="checkbox"
                checked={selectAllIntervalsChecked}
                onChange={(e) => {
                    const updatedIntervals = e.target.checked
                    ? [...watchedIntervals].concat(intervals)
                    : [];
                    setSelectAllIntervalsChecked(e.target.checked); // Update the state
                    setValue("userIntervals", updatedIntervals);
                }}
                />Select all
            </label>

            {intervals.map((interval) => (
            <div key={interval}><label key={interval}>
                <input
                type="checkbox"
                checked={watchedIntervals.includes(interval)}
                onChange={(e) => {
                    const updatedIntervals = e.target.checked
                    ? [...watchedIntervals, interval]
                    : watchedIntervals.filter((id) => id !== interval); 
                    setValue("userIntervals", updatedIntervals);
                }}
                />
                {interval}
            </label>
            </div>
            ))}
        </div>

      <div>
        <label className="main">Subjects</label>
        {subjects.map((domain) => (
          <div key={domain.id}>
            <label>
              <input
                type="checkbox"
                checked={watchedSubjects.includes(domain.id)}
                onChange={(e) => togglefields(domain.id, e.target.checked)}
              />
              {domain.display_name}
            </label>
            <div style={{ marginLeft: "1em" }}>
              {domain.fields.map((sub) => (
                <div key={sub.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={watchedSubjects.includes(sub.id)}
                      onChange={(e) => {
                        const updatedSubjects = e.target.checked
                          ? [...watchedSubjects, sub.id]
                          : watchedSubjects.filter((id) => id !== sub.id);
                        setValue("userSubjects", updatedSubjects);
                        console.log(updatedSubjects);
                      }}
                    />
                    {sub.display_name}
                  </label>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button type="submit" className="main">Submit 
      </button>{isSubmitted && <span className="thanks">Thanks for signing up!</span>}
    </form>
  );
};

export default FormComponent;